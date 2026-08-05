/**
 * Purchase-order service — the single place POs are created and mutated
 * (PO_PLAN). Mirrors the orders-service seam: all validation, snapshotting,
 * status-machine guarding, and event emission live here; routes and UI call
 * these functions and never write the PO tables directly.
 *
 * Every mutation both emits an outbox event on the parent ORDER aggregate
 * (in-transaction) and records an audit row, so the order timeline shows the
 * full production history.
 */
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import {
  auditEvents,
  garments,
  orders,
  poSupplierAccess,
  purchaseOrderRevisions,
  purchaseOrders,
  supplierColorBooks,
  suppliers,
  workflowStages,
  workflowStageTasks,
  workflowTaskCompletions,
} from '@/db/schema';
import type { PoSnapshot } from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';
import { sendSupplierPoEmail } from '@/lib/email';
import { getFileBuffer } from '@/lib/storage';
import { signPoSnapshotMedia } from '@/lib/signed-urls';
import { logger } from '@/lib/logger';
import { pickDefined } from '@/lib/patch';
import { buildSupplierPoUrl } from '@/lib/tokens';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { ConflictError, NotFoundError } from '@/server/orders/service';
import { syncOrderProductionStatus } from './hub-sync';
import { loadPoAssets } from '@/server/orders/assets-service';
import { assertGateOpen } from '@/server/workflow/gates';
import { supplierCodeOrFallback } from '@/server/suppliers/service';
import { buildPoWorkbook } from './xlsx';
import {
  canTransition,
  type CreatePurchaseOrderInput,
  type IssueRevisionInput,
  type PoStatus,
  type UpdatePurchaseOrderInput,
} from './contract';
import {
  buildPoSnapshot,
  computeCoverage,
  detectVariance,
  varianceCounts,
  type LiveGarment,
} from './snapshot';

/** Actor attribution for audit rows + createdBy stamps. */
export interface ActorMeta {
  actorStaffUserId?: string | null;
  actorEmail?: string | null;
  /**
   * Set to send a PO despite an outstanding pre-production check. Requires a
   * reason, which is audited — an override with no reason is indistinguishable
   * from having no gate at all.
   */
  gateOverrideReason?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadPoOrThrow(id: string) {
  const po = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) });
  if (!po) throw new NotFoundError('Purchase order');
  return po;
}

/**
 * The order's confirmed pre-production checks, for the revision snapshot.
 * One row per confirming person (that is what makes "checked" and
 * "double-checked" two entries rather than one), newest last.
 */
async function loadOrderChecks(orderId: string) {
  const rows = await db
    .select({
      taskName: workflowStageTasks.name,
      stageName: workflowStages.name,
      byEmail: workflowTaskCompletions.confirmedByEmail,
      at: workflowTaskCompletions.confirmedAt,
    })
    .from(workflowTaskCompletions)
    .innerJoin(workflowStageTasks, eq(workflowStageTasks.id, workflowTaskCompletions.taskId))
    .innerJoin(workflowStages, eq(workflowStages.id, workflowStageTasks.stageId))
    .where(
      and(
        eq(workflowTaskCompletions.entityType, 'order'),
        eq(workflowTaskCompletions.entityId, orderId),
      ),
    )
    .orderBy(workflowTaskCompletions.confirmedAt);

  return rows.map((r) => ({
    taskName: r.taskName,
    stageName: r.stageName ?? null,
    byEmail: r.byEmail ?? null,
    at: r.at.toISOString(),
  }));
}

/** All garments of an order with sizing rows + type name — the snapshot/variance input. */
async function loadOrderGarments(orderId: string) {
  return db.query.garments.findMany({
    where: eq(garments.orderId, orderId),
    orderBy: (g, { asc }) => [asc(g.sortOrder), asc(g.createdAt)],
    with: {
      sizing: { orderBy: (s, { asc }) => [asc(s.sortOrder), asc(s.createdAt)] },
      garmentType: { columns: { name: true } },
      // The reference charts the factory cuts to — captured into the revision
      // snapshot, and compared by variance so a re-linked chart flags the PO.
      sizeChartLinks: {
        with: { sizeChart: { columns: { id: true, name: true, storageKey: true } } },
      },
      // Mock-up images ride the snapshot too (David, 2026-08-05: the supplier
      // PO must show the garment images).
      images: { orderBy: (i, { asc }) => [asc(i.sortOrder), asc(i.createdAt)] },
    },
  });
}

/**
 * Resolve the colour book a PO records (David, 2026-08-05). An explicit id
 * must belong to THIS supplier (a book id from another supplier is a 409, not
 * a silent cross-link); omitted picks the supplier's newest book — "we
 * typically use the latest one" — or none when the supplier has no books yet.
 */
async function resolveColorBook(
  supplierId: string,
  colorBookId: string | undefined | null,
): Promise<{ id: string; name: string } | null> {
  if (colorBookId === null) return null;
  if (colorBookId) {
    const book = await db.query.supplierColorBooks.findFirst({
      where: eq(supplierColorBooks.id, colorBookId),
    });
    if (!book || book.supplierId !== supplierId) {
      throw new ConflictError('That colour book does not belong to this supplier');
    }
    return { id: book.id, name: book.name };
  }
  const [latest] = await db.query.supplierColorBooks.findMany({
    where: eq(supplierColorBooks.supplierId, supplierId),
    orderBy: (b, { desc: d }) => [d(b.createdAt)],
    limit: 1,
  });
  return latest ? { id: latest.id, name: latest.name } : null;
}

/**
 * Build the next PO number: `{CODE}{seq}` (David, 2026-08-05 — DY123,
 * GOAL123; each supplier counts alone, and the number doubles as the portal
 * URL path `/supplier/{CODE}/po/{poNumber}`).
 *
 * The sequence is the supplier row's `po_seq` counter, incremented HERE with
 * an UPDATE inside the caller's transaction — the row lock serializes two
 * concurrent creates for the same supplier, so unlike the old prefix-count
 * scheme there is no race to the same number. The unique-violation retry in
 * createPurchaseOrder stays as a belt-and-braces backstop (e.g. a manually
 * renumbered row colliding with the counter).
 *
 * POs predating the format keep their `PO-{YYMM}-…` numbers; both formats are
 * opaque strings everywhere downstream.
 */
export async function generatePoNumber(
  tx: Transaction,
  supplier: { id: string; name: string; supplierCode: string | null },
): Promise<string> {
  const code = supplierCodeOrFallback(supplier);
  const [{ seq }] = await tx
    .update(suppliers)
    .set({ poSeq: sql`${suppliers.poSeq} + 1` })
    .where(eq(suppliers.id, supplier.id))
    .returning({ seq: suppliers.poSeq });
  return `${code}${seq}`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createPurchaseOrder(input: CreatePurchaseOrderInput, meta?: ActorMeta) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, input.orderId),
    // sourceOrder: a reprint tells the factory which job to reuse the layout from.
    with: { sourceOrder: { columns: { orderNumber: true } } },
  });
  if (!order) throw new NotFoundError('Order');

  const supplier = await db.query.suppliers.findFirst({
    where: eq(suppliers.id, input.supplierId),
  });
  if (!supplier) throw new NotFoundError('Supplier');
  if (!supplier.isActive) throw new ConflictError('Supplier is inactive');

  const colorBook = await resolveColorBook(supplier.id, input.colorBookId);

  const liveGarments = await loadOrderGarments(order.id);
  const liveById = new Map(liveGarments.map((g) => [g.id, g]));
  const uniqueIds = [...new Set(input.garmentIds)];
  const selected = uniqueIds.flatMap((gid) => {
    const g = liveById.get(gid);
    return g ? [g] : [];
  });
  if (selected.length !== uniqueIds.length) {
    throw new ConflictError('One or more garments do not belong to this order');
  }
  if (selected.every((g) => g.sizing.length === 0)) {
    throw new ConflictError('Selected garments have no sizing rows');
  }

  const snapshot = buildPoSnapshot(
    {
      orderNumber: order.orderNumber,
      reprintOfOrderNumber: order.sourceOrder?.orderNumber ?? null,
      preparedByEmail: meta?.actorEmail ?? null,
    },
    selected,
    await loadPoAssets(order.id),
    await loadOrderChecks(order.id),
  );

  const create = () =>
    db.transaction(async (tx) => {
      const poNumber = await generatePoNumber(tx, supplier);

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          poNumber,
          orderId: order.id,
          supplierId: supplier.id,
          status: 'draft',
          currentRevisionNumber: 1,
          // The CUSTOMER deadline, copied from the order (David, 2026-08-05):
          // it exists so production staff can spot POs cutting it fine, is
          // re-synced when the order's deadline changes, and must NEVER reach
          // the supplier (portal, PDF and XLSX all omit it).
          deadlineDate: order.deadlineDate ?? null,
          expectedShipDate: input.expectedShipDate ?? null,
          notes: input.notes ?? null,
          // The supplier's colour book this job is matched against (David,
          // 2026-08-05) — resolved above; defaults to the supplier's newest.
          colorBookId: colorBook?.id ?? null,
          colorBookName: colorBook?.name ?? null,
          createdBy: meta?.actorStaffUserId ?? null,
        })
        .returning();

      const [revision] = await tx
        .insert(purchaseOrderRevisions)
        .values({
          poId: po.id,
          revisionNumber: 1,
          reason: null, // revision 1 is the original — reason is for re-issues
          snapshot,
          createdBy: meta?.actorStaffUserId ?? null,
        })
        .returning();

      await emitOrderEvent(tx, {
        aggregateId: order.id,
        eventType: 'po.created',
        payload: {
          poId: po.id,
          poNumber: po.poNumber,
          supplierId: supplier.id,
          supplierName: supplier.name,
        },
      });
      await recordAuditEvent(
        {
          aggregateId: order.id,
          eventType: 'po.created',
          payload: { poId: po.id, poNumber: po.poNumber },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );

      return { ...po, revision };
    });

  // Retry once on a po-number collision (two creates racing to the same NN).
  try {
    return await create();
  } catch (err) {
    if (isUniqueViolation(err, 'purchase_orders_po_number_unique')) return await create();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getPurchaseOrder(id: string) {
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: {
      supplier: true,
      order: {
        columns: {
          id: true,
          orderNumber: true,
          customerName: true,
          status: true,
          colorSampleRequestedAt: true,
          // The customer deadline — displayed on the admin PO page (the PO's
          // own deadlineDate mirrors it, but serving the order's live value
          // means the display can never be stale).
          deadlineDate: true,
        },
      },
      revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)] },
      shipmentLinks: { with: { shipment: true } },
    },
  });
  if (!po) throw new NotFoundError('Purchase order');

  const [activeSupplierLink] = await db
    .select({ lastViewedAt: poSupplierAccess.lastViewedAt })
    .from(poSupplierAccess)
    .where(and(eq(poSupplierAccess.purchaseOrderId, id), isNull(poSupplierAccess.revokedAt)));

  const { shipmentLinks, ...rest } = po;
  return {
    ...rest,
    shipments: shipmentLinks.map((l) => l.shipment),
    supplierLink: activeSupplierLink
      ? { active: true as const, lastViewedAt: activeSupplierLink.lastViewedAt }
      : { active: false as const, lastViewedAt: null },
    portalUrl: buildSupplierPoUrl(supplierCodeOrFallback(po.supplier), po.poNumber),
    history: await listPoHistory(po.orderId, id),
  };
}

/**
 * The PO's who/when record (David, 2026-08-05): status changes, ship-date
 * moves, sends and supplier updates, newest first — read from the audit
 * trail, filtered to THIS PO by the poId every PO audit payload carries.
 */
export async function listPoHistory(orderId: string, poId: string) {
  const rows = await db
    .select({
      id: auditEvents.id,
      eventType: auditEvents.eventType,
      actorEmail: auditEvents.actorEmail,
      payload: auditEvents.payload,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.aggregateId, orderId),
        sql`${auditEvents.payload}->>'poId' = ${poId}`,
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(100);
  return rows;
}

export async function listRevisions(id: string) {
  await loadPoOrThrow(id);
  return db.query.purchaseOrderRevisions.findMany({
    where: eq(purchaseOrderRevisions.poId, id),
    orderBy: (r, { desc }) => [desc(r.revisionNumber)],
  });
}

export async function listPurchaseOrders(opts?: {
  status?: PoStatus;
  supplierId?: string;
  search?: string;
}) {
  const conditions = [];
  if (opts?.status) conditions.push(eq(purchaseOrders.status, opts.status));
  if (opts?.supplierId) conditions.push(eq(purchaseOrders.supplierId, opts.supplierId));
  if (opts?.search?.trim()) {
    const term = `%${opts.search.trim()}%`;
    conditions.push(
      or(
        ilike(purchaseOrders.poNumber, term),
        ilike(orders.orderNumber, term),
        ilike(orders.customerName, term),
        ilike(suppliers.name, term),
      ),
    );
  }

  return db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      currentRevisionNumber: purchaseOrders.currentRevisionNumber,
      deadlineDate: purchaseOrders.deadlineDate,
      expectedShipDate: purchaseOrders.expectedShipDate,
      actualShipDate: purchaseOrders.actualShipDate,
      sentAt: purchaseOrders.sentAt,
      createdAt: purchaseOrders.createdAt,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .innerJoin(orders, eq(purchaseOrders.orderId, orders.id))
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(purchaseOrders.createdAt));
}

/**
 * The order-detail Production panel in one read: every sizing row of the
 * order, every PO with its latest snapshot + live variance, and row-level
 * coverage. Shaped for direct JSON serving.
 */
export async function getOrderProductionSummary(orderId: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, orderNumber: true },
  });
  if (!order) throw new NotFoundError('Order');

  const liveGarments = await loadOrderGarments(orderId);
  const pos = await db.query.purchaseOrders.findMany({
    where: eq(purchaseOrders.orderId, orderId),
    orderBy: (po, { desc }) => [desc(po.createdAt)],
    with: {
      supplier: { columns: { id: true, name: true } },
      revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)] },
    },
  });

  const purchaseOrderSummaries = pos.map((po) => {
    const latest = po.revisions[0]; // revisions are ordered desc; rev 1 always exists
    const variance = detectVariance(liveGarments as LiveGarment[], latest.snapshot);
    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      currentRevisionNumber: po.currentRevisionNumber,
      deadlineDate: po.deadlineDate,
      expectedShipDate: po.expectedShipDate,
      actualShipDate: po.actualShipDate,
      sentAt: po.sentAt,
      receivedAt: po.receivedAt,
      supplier: po.supplier,
      latestRevision: {
        revisionNumber: latest.revisionNumber,
        reason: latest.reason,
        createdAt: latest.createdAt,
        snapshot: latest.snapshot,
      },
      variance,
      varianceCounts: varianceCounts(variance),
    };
  });

  const coverage = computeCoverage(
    liveGarments.flatMap((g) => g.sizing.map((row) => ({ id: row.id, garmentId: g.id }))),
    pos.map((po) => ({
      poId: po.id,
      poNumber: po.poNumber,
      status: po.status,
      latestSnapshot: po.revisions[0].snapshot,
    })),
  );

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    garments: liveGarments.map((g) => ({
      id: g.id,
      name: g.name,
      sizingRowCount: g.sizing.length,
    })),
    purchaseOrders: purchaseOrderSummaries,
    coverage,
  };
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/** Dates/notes only — content changes go through issueRevision, status through updatePurchaseOrderStatus. */
export async function updatePurchaseOrder(
  id: string,
  patch: UpdatePurchaseOrderInput,
  meta?: ActorMeta,
) {
  const po = await loadPoOrThrow(id);

  // colorBookId is resolved, not written raw: it must belong to the PO's
  // supplier, and the denormalized name travels with it (or clears with it).
  const { colorBookId, ...plainPatch } = patch;
  const colorBookFields =
    colorBookId === undefined
      ? {}
      : await resolveColorBook(po.supplierId, colorBookId).then((book) => ({
          colorBookId: book?.id ?? null,
          colorBookName: book?.name ?? null,
        }));

  const defined = { ...pickDefined(plainPatch), ...colorBookFields };
  if (Object.keys(defined).length > 0) {
    await db
      .update(purchaseOrders)
      .set({ ...defined, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));
  }

  await recordAuditEvent({
    aggregateId: po.orderId,
    eventType: 'po.updated',
    payload: { poId: id, poNumber: po.poNumber, fields: Object.keys(defined) },
    actorEmail: meta?.actorEmail ?? null,
  });

  // A ship-date move gets its own from→to audit row (David, 2026-08-05: the
  // PO must record who changed the expected ship date and when) — the generic
  // po.updated row above only names the field, which cannot answer "what did
  // it slip from". Same event the supplier-portal ship-date path records.
  if (
    patch.expectedShipDate !== undefined &&
    (patch.expectedShipDate ?? null) !== po.expectedShipDate
  ) {
    await recordAuditEvent({
      aggregateId: po.orderId,
      eventType: 'po.ship_date_changed',
      payload: {
        poId: id,
        poNumber: po.poNumber,
        from: po.expectedShipDate,
        to: patch.expectedShipDate ?? null,
      },
      actorEmail: meta?.actorEmail ?? null,
    });
  }

  return (await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) }))!;
}

/**
 * The status transition itself, inside a caller-supplied transaction.
 *
 * Split out from the public function below so a workflow stage move can write
 * the stage and the status in ONE transaction. Two transactions would leave a
 * window where a failure between them puts the board and the status permanently
 * out of step — invisible until a customer asks where their order is.
 *
 * Validates the transition itself, so no caller can route around `canTransition`
 * by reaching for the tx-aware form.
 *
 * The caller MUST call `syncOrderProductionStatus(po.orderId)` after the
 * transaction commits — it is a network write-back and has no place inside a
 * database transaction. The public wrapper does this; new callers must too.
 */
export async function updatePurchaseOrderStatusTx(
  tx: Transaction,
  po: { id: string; orderId: string; poNumber: string; status: PoStatus; sentAt: Date | null },
  nextStatus: PoStatus,
  meta?: ActorMeta,
) {
  const from = po.status;
  if (!canTransition(from, nextStatus)) {
    throw new ConflictError(`Cannot move a ${from} purchase order to ${nextStatus}`);
  }

  const now = new Date();
  const [row] = await tx
    .update(purchaseOrders)
    .set({
      status: nextStatus,
      // sentAt marks the FIRST send — a remake loop must not overwrite it.
      ...(nextStatus === 'sent' && po.sentAt === null ? { sentAt: now } : {}),
      ...(nextStatus === 'received' ? { receivedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(purchaseOrders.id, po.id))
    .returning();

  await emitOrderEvent(tx, {
    aggregateId: po.orderId,
    eventType: 'po.status_changed',
    payload: { poId: po.id, poNumber: po.poNumber, from, to: nextStatus },
  });
  if (nextStatus === 'cancelled') {
    await emitOrderEvent(tx, {
      aggregateId: po.orderId,
      eventType: 'po.cancelled',
      payload: { poId: po.id, poNumber: po.poNumber },
    });
  }
  await recordAuditEvent(
    {
      aggregateId: po.orderId,
      eventType: 'po.status_changed',
      payload: { poId: po.id, poNumber: po.poNumber, from, to: nextStatus },
      actorEmail: meta?.actorEmail ?? null,
    },
    tx,
  );

  return row;
}

export async function updatePurchaseOrderStatus(
  id: string,
  nextStatus: PoStatus,
  meta?: ActorMeta,
) {
  const po = await loadPoOrThrow(id);

  const updated = await db.transaction((tx) =>
    updatePurchaseOrderStatusTx(tx, po, nextStatus, meta),
  );

  // Fire-and-forget hub write-back AFTER commit — dormant unless the hub is
  // configured and the order is platform-known (see hub-sync.ts).
  void syncOrderProductionStatus(po.orderId);

  return updated;
}

// ---------------------------------------------------------------------------
// Supplier portal link (SUPPLIER_PORTAL_PLAN.md)
// ---------------------------------------------------------------------------

// The manual generate/revoke supplier-link actions are GONE (David,
// 2026-08-05): the pretty per-PO URL is deterministic from the PO number and
// gated by the supplier's portal password, so there is nothing to mint.
// Legacy per-PO tokens already in supplier inboxes keep resolving via
// /s/[token] (resolveActiveToken is untouched); they are just never minted
// again.

// ---------------------------------------------------------------------------
// Send to supplier
// ---------------------------------------------------------------------------

/**
 * The props the injected PDF renderer receives — structurally identical to
 * `PoPdfProps` (src/components/admin/purchase-orders/PoPdf.tsx), redeclared
 * here so this service never imports react-pdf/component code. The ROUTE
 * passes a closure that renders `<PoPdf {...props} />` to a Buffer.
 */
export interface RenderPoPdfProps {
  poNumber: string;
  revisionNumber: number;
  revisionReason: string | null;
  createdAt: string;
  // No deadlineDate: the PO's deadline is the CUSTOMER deadline (2026-08-05)
  // and the PDF is a supplier-facing document — it must never render it.
  expectedShipDate: string | null;
  /** The supplier's colour book the job is matched against — factory-relevant. */
  colorBookName: string | null;
  notes: string | null;
  supplier: {
    name: string;
    contactPerson: string | null;
    email: string | null;
    phone: string | null;
  };
  snapshot: PoSnapshot;
}

/**
 * Email the LATEST revision's PDF to the supplier.
 *
 * Guards: the supplier must have an email address, and the PO must be in
 * `draft` or `sent` (resending an already-sent PO is legal — e.g. after a
 * revision); any other status conflicts. On success a draft PO transitions to
 * `sent` through the normal status machine (stamping `sentAt`), and a
 * `po.sent` outbox event + audit row are recorded on the parent order.
 */
/** Per-type counts of what actually made it into the email, for the UI. */
export interface AttachmentCounts {
  images: number;
  fonts: number;
  sizeCharts: number;
}

/**
 * The files that ride the supplier email alongside the PDF/XLSX: uploaded
 * assets (fonts, design files), the size charts each garment cuts to, and
 * each garment's mock-up images.
 *
 * From the SNAPSHOT, not the live rows — the email must match the document of
 * record. As actual attachments, not signed URLs, because a URL in a sent
 * email expires and the factory opens these weeks later.
 *
 * A file that cannot be fetched is skipped with a warning rather than failing
 * the send: the PDF itself is the contract, the attachments are supporting
 * material, and blocking a PO on a single unreadable object helps nobody. The
 * PDF names every file it expects, so a gap is visible to the recipient too.
 *
 * `preferThumbnails` swaps each garment image's full-resolution storage key
 * for its thumbnail — used by the size-budget fallback in `sendPurchaseOrder`
 * when the full set would exceed the SMTP size cap.
 */
async function collectSnapshotAttachments(
  snapshot: PoSnapshot,
  options?: { preferThumbnails?: boolean },
): Promise<{ attachments: { filename: string; content: Buffer }[]; counts: AttachmentCounts }> {
  const wanted = new Map<string, string>(); // storageKey -> filename
  const kindByKey = new Map<string, keyof AttachmentCounts>();

  for (const asset of snapshot.assets ?? []) {
    if (asset.storageKey) {
      const ext = asset.storageKey.split('.').pop() ?? 'bin';
      wanted.set(asset.storageKey, `${asset.name}.${ext}`);
      kindByKey.set(asset.storageKey, 'fonts');
    }
  }
  // Charts dedupe across garments — two garments cutting to the same chart
  // should not attach it twice.
  for (const garment of snapshot.garments) {
    for (const chart of garment.sizeCharts ?? []) {
      if (chart.storageKey && !wanted.has(chart.storageKey)) {
        const ext = chart.storageKey.split('.').pop() ?? 'bin';
        wanted.set(chart.storageKey, `size-chart-${chart.name}.${ext}`);
        kindByKey.set(chart.storageKey, 'sizeCharts');
      }
    }
  }
  // Garment mock-up images — full resolution by default (the factory prints/
  // cuts from these), thumbnails when the size-budget guard has kicked in.
  // Deduped per-garment with a counter so two uncaptioned images on the same
  // garment don't collide on one filename.
  for (const garment of snapshot.garments) {
    let n = 0;
    for (const image of garment.images ?? []) {
      const key = options?.preferThumbnails
        ? image.thumbnailStorageKey ?? image.storageKey
        : image.storageKey;
      if (!key || wanted.has(key)) continue;
      n += 1;
      const ext = key.split('.').pop() ?? 'bin';
      const caption = image.caption?.trim();
      const base = caption ? `${garment.name}-${caption}` : `${garment.name}-${n}`;
      wanted.set(key, `${base}.${ext}`);
      kindByKey.set(key, 'images');
    }
  }

  const attachments: { filename: string; content: Buffer }[] = [];
  const counts: AttachmentCounts = { images: 0, fonts: 0, sizeCharts: 0 };
  for (const [key, filename] of wanted) {
    try {
      attachments.push({ filename, content: await getFileBuffer(key) });
      const kind = kindByKey.get(key);
      if (kind) counts[kind] += 1;
    } catch (err) {
      logger.warn('[po/send] attachment skipped — could not read from storage', { key, filename, err });
    }
  }
  return { attachments, counts };
}

interface ProductionRecipient {
  to: string;
  toName: string;
}

/**
 * Who a PO send actually goes to. Today this is always the PO's own
 * supplier — there is no other recipient concept in this codebase
 * (AUTO_ORDER_EMAIL_PLAN.md Open Question 1). Kept as its own function so a
 * later decision (a distinct production-team contact, a cc, a company-wide
 * inbox) is a change here, not a rewrite of sendPurchaseOrder's gate/
 * attachment/status logic.
 */
function resolveProductionRecipients(po: {
  supplier: { email: string | null; contactPerson: string | null; name: string };
}): ProductionRecipient[] {
  if (!po.supplier.email) return [];
  return [{ to: po.supplier.email, toName: po.supplier.contactPerson ?? po.supplier.name }];
}

// Headroom under Mailgun's ~25MB message-size cap (AUTO_ORDER_EMAIL_PLAN.md
// Phase 1.3). A PO with several garments each carrying full-res mock-ups can
// plausibly get there; blowing the cap silently bounces the send.
const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export async function sendPurchaseOrder(
  id: string,
  meta: ActorMeta,
  renderPdf: (props: RenderPoPdfProps) => Promise<Buffer>,
) {
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: {
      supplier: true,
      order: { columns: { orderNumber: true } },
      revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)], limit: 1 },
    },
  });
  if (!po) throw new NotFoundError('Purchase order');
  // APPROVED gates the send (David, 2026-08-05): a draft must be internally
  // signed off before it can go to the factory. Resending an already-sent PO
  // (or one further along) after a revision stays legal.
  if (po.status === 'draft') {
    throw new ConflictError('Approve the purchase order before sending it');
  }
  if (po.status === 'cancelled' || po.status === 'completed' || po.status === 'received') {
    throw new ConflictError(`Cannot send a ${po.status} purchase order`);
  }
  const recipients = resolveProductionRecipients(po);
  if (recipients.length === 0) throw new ConflictError('Supplier has no email address');

  // Gate check goes HERE: after the cheap validity checks, before the PDF render
  // and the email. Rendering first would waste the work; checking earlier would
  // report a gate problem on a PO that could not be sent anyway.
  //
  // Evaluated against the ORDER's checklist — pre-production steps live on the
  // job, so a second PO for the same order faces the same checks as the first.
  await assertGateOpen('po_send', 'order', po.orderId, {
    override: meta.gateOverrideReason
      ? { reason: meta.gateOverrideReason, actorEmail: meta.actorEmail }
      : undefined,
    context: { poId: po.id, poNumber: po.poNumber },
  });

  const latest = po.revisions[0]; // rev 1 always exists

  const pdf = await renderPdf({
    poNumber: po.poNumber,
    revisionNumber: latest.revisionNumber,
    revisionReason: latest.reason,
    createdAt: latest.createdAt.toISOString(),
    expectedShipDate: po.expectedShipDate,
    colorBookName: po.colorBookName,
    notes: po.notes,
    supplier: {
      name: po.supplier.name,
      contactPerson: po.supplier.contactPerson,
      email: po.supplier.email,
      phone: po.supplier.phone,
    },
    // Signed so the PDF can EMBED the garment mock-up images (the bytes land
    // in the document at render time — no expiring URL survives in the email).
    // On a storage hiccup URLs come back null and PoPdf skips those images.
    snapshot: await signPoSnapshotMedia(latest.snapshot),
  });

  // UNSIGNED snapshot — the workbook only lists image captions/filenames as
  // text (xlsx.ts), it never embeds bytes, so it needs no signed URLs. Kept
  // as a separate read from the PDF's signed copy so a future change to
  // signing can't silently affect the workbook too.
  const xlsx = await buildPoWorkbook({
    poNumber: po.poNumber,
    revisionNumber: latest.revisionNumber,
    revisionReason: latest.reason,
    createdAt: latest.createdAt.toISOString(),
    expectedShipDate: po.expectedShipDate,
    notes: po.notes,
    supplier: {
      name: po.supplier.name,
      contactPerson: po.supplier.contactPerson,
      email: po.supplier.email,
      phone: po.supplier.phone,
    },
    snapshot: latest.snapshot,
  });

  let { attachments: extraAttachments, counts } = await collectSnapshotAttachments(latest.snapshot);
  let sizeReduced = false;
  const totalBytes =
    pdf.length + xlsx.length + extraAttachments.reduce((sum, a) => sum + a.content.length, 0);
  if (totalBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
    logger.warn('[po/send] attachment set over size budget — falling back to thumbnail images', {
      poId: po.id,
      poNumber: po.poNumber,
      totalBytes,
    });
    ({ attachments: extraAttachments, counts } = await collectSnapshotAttachments(latest.snapshot, {
      preferThumbnails: true,
    }));
    sizeReduced = true;
  }

  // The pretty per-PO portal URL (David, 2026-08-05): deterministic from the
  // supplier code + PO number, gated by the supplier's portal password — no
  // token to mint, and the link in an old email never stops working.
  const portalUrl = buildSupplierPoUrl(supplierCodeOrFallback(po.supplier), po.poNumber);

  for (const recipient of recipients) {
    await sendSupplierPoEmail({
      to: recipient.to,
      toName: recipient.toName,
      poNumber: po.poNumber,
      orderNumber: po.order.orderNumber,
      revisionNumber: latest.revisionNumber,
      reason: latest.reason,
      pdf,
      xlsx,
      sizeReduced,
      portalUrl,
      extraAttachments,
    });
  }

  // First send moves approved → sent via the normal status machine (sentAt
  // stamp + status_changed event). A resend leaves the status untouched.
  if (po.status === 'approved') {
    await updatePurchaseOrderStatus(id, 'sent', meta);
  }

  const payload = {
    poId: id,
    poNumber: po.poNumber,
    revisionNumber: latest.revisionNumber,
    to: recipients.map((r) => r.to).join(', '),
  };
  await db.transaction(async (tx) => {
    await emitOrderEvent(tx, { aggregateId: po.orderId, eventType: 'po.sent', payload });
    await recordAuditEvent(
      {
        aggregateId: po.orderId,
        eventType: 'po.sent',
        payload,
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );
  });

  return {
    poNumber: po.poNumber,
    to: recipients[0].to,
    attachmentSummary: { ...counts, sizeReduced },
  };
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

/**
 * Re-snapshot the PO from LIVE order data as a new immutable revision.
 * Garment scope defaults to the previous revision's garments (minus any that
 * were removed from the order); pass `garmentIds` to change the scope.
 */
export async function issueRevision(id: string, input: IssueRevisionInput, meta?: ActorMeta) {
  const po = await loadPoOrThrow(id);
  if (po.status === 'cancelled' || po.status === 'completed') {
    throw new ConflictError(`Cannot revise a ${po.status} purchase order`);
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, po.orderId),
    with: { sourceOrder: { columns: { orderNumber: true } } },
  });
  if (!order) throw new NotFoundError('Order');

  const latest = await db.query.purchaseOrderRevisions.findFirst({
    where: eq(purchaseOrderRevisions.poId, id),
    orderBy: (r, { desc }) => [desc(r.revisionNumber)],
  });
  if (!latest) throw new NotFoundError('Purchase order revision');

  const liveGarments = await loadOrderGarments(po.orderId);
  const liveById = new Map(liveGarments.map((g) => [g.id, g]));

  let selected: typeof liveGarments;
  if (input.garmentIds) {
    const uniqueIds = [...new Set(input.garmentIds)];
    selected = uniqueIds.flatMap((gid) => {
      const g = liveById.get(gid);
      return g ? [g] : [];
    });
    if (selected.length !== uniqueIds.length) {
      throw new ConflictError('One or more garments do not belong to this order');
    }
  } else {
    // Previous scope ∩ garments still on the order.
    selected = latest.snapshot.garments.flatMap((g) => {
      const live = liveById.get(g.garmentId);
      return live ? [live] : [];
    });
  }
  if (selected.length === 0) {
    throw new ConflictError('No garments to snapshot — the previous scope is no longer on the order');
  }

  const snapshot = buildPoSnapshot(
    {
      orderNumber: order.orderNumber,
      reprintOfOrderNumber: order.sourceOrder?.orderNumber ?? null,
      preparedByEmail: meta?.actorEmail ?? null,
    },
    selected,
    await loadPoAssets(order.id),
    await loadOrderChecks(order.id),
  );
  const revisionNumber = latest.revisionNumber + 1;

  return db.transaction(async (tx) => {
    const [revision] = await tx
      .insert(purchaseOrderRevisions)
      .values({
        poId: id,
        revisionNumber,
        reason: input.reason,
        snapshot,
        createdBy: meta?.actorStaffUserId ?? null,
      })
      .returning();

    await tx
      .update(purchaseOrders)
      .set({ currentRevisionNumber: revisionNumber, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));

    await emitOrderEvent(tx, {
      aggregateId: po.orderId,
      eventType: 'po.revised',
      payload: { poId: id, poNumber: po.poNumber, revisionNumber, reason: input.reason },
    });
    await recordAuditEvent(
      {
        aggregateId: po.orderId,
        eventType: 'po.revised',
        payload: { poId: id, poNumber: po.poNumber, revisionNumber, reason: input.reason },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );

    return revision;
  });
}
