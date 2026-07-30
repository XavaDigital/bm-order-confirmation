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
import { and, desc, count, eq, ilike, isNull, like, or } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import {
  garments,
  orders,
  poSupplierAccess,
  purchaseOrderRevisions,
  purchaseOrders,
  suppliers,
} from '@/db/schema';
import type { PoSnapshot } from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';
import { sendSupplierPoEmail } from '@/lib/email';
import { getFileBuffer } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { pickDefined } from '@/lib/patch';
import { generateToken, buildSupplierPortalUrl } from '@/lib/tokens';
import { mintToken, revokeActiveTokens } from '@/server/access/tokens';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { ConflictError, NotFoundError } from '@/server/orders/service';
import { syncOrderProductionStatus } from './hub-sync';
import { loadPoAssets } from '@/server/orders/assets-service';
import { assertGateOpen } from '@/server/workflow/gates';
import { supplierCodeOrFallback } from '@/server/suppliers/service';
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
    },
  });
}

/**
 * Build the next PO number: `PO-{YY}{MM}-{CODE}{NN}-{CUSTOMER}`.
 *
 * NN is the count of existing POs sharing the `PO-{YYMM}-{CODE}` prefix + 1
 * (zero-padded to 2), computed inside the caller's transaction. Two
 * concurrent creates can still race to the same NN — callers retry once on
 * the po_number unique violation (see createPurchaseOrder).
 */
export async function generatePoNumber(
  tx: Transaction,
  supplier: { name: string; supplierCode: string | null },
  customerName: string,
  now: Date,
): Promise<string> {
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const code = supplierCodeOrFallback(supplier);
  const prefix = `PO-${yy}${mm}-${code}`;

  const [{ existing }] = await tx
    .select({ existing: count() })
    .from(purchaseOrders)
    .where(like(purchaseOrders.poNumber, `${prefix}%`));
  const nn = String(Number(existing) + 1).padStart(2, '0');

  const customer = customerName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
  return `${prefix}${nn}-${customer}`;
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
    { orderNumber: order.orderNumber, reprintOfOrderNumber: order.sourceOrder?.orderNumber ?? null },
    selected,
    await loadPoAssets(order.id),
  );

  const create = () =>
    db.transaction(async (tx) => {
      const poNumber = await generatePoNumber(tx, supplier, order.customerName, new Date());

      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          poNumber,
          orderId: order.id,
          supplierId: supplier.id,
          status: 'draft',
          currentRevisionNumber: 1,
          deadlineDate: input.deadlineDate ?? null,
          expectedShipDate: input.expectedShipDate ?? null,
          notes: input.notes ?? null,
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
  };
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

  const defined = pickDefined(patch);
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

/**
 * Mint (or rotate) the token-gated supplier portal link for this PO — same
 * revoke-then-insert pattern `generateAccessToken`/`generateRosterToken` use,
 * via the shared `mintToken` helper. One active link per PO, enforced at the
 * DB level (`po_supplier_access_one_active_uq`).
 *
 * Called both from the manual "Generate/Regenerate link" admin action AND
 * automatically from `sendPurchaseOrder` on every send — a resend always
 * carries a fresh working link, at the cost of invalidating one shared
 * earlier (the same tradeoff TEAM_ROSTER_PLAN.md's roster-reminder "Regenerate
 * link" already accepts).
 */
export async function generateSupplierPortalLink(id: string, meta?: ActorMeta): Promise<string> {
  const po = await loadPoOrThrow(id);
  const rawToken = generateToken();

  await db.transaction(async (tx) => {
    await mintToken(
      tx,
      poSupplierAccess,
      rawToken,
      eq(poSupplierAccess.purchaseOrderId, id),
      { purchaseOrderId: id },
    );
    await emitOrderEvent(tx, {
      aggregateId: po.orderId,
      eventType: 'supplier_link.generated',
      payload: { poId: id, poNumber: po.poNumber },
    });
    await recordAuditEvent(
      {
        aggregateId: po.orderId,
        eventType: 'supplier_link.generated',
        payload: { poId: id, poNumber: po.poNumber },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );
  });

  return buildSupplierPortalUrl(rawToken);
}

export async function revokeSupplierPortalLink(id: string, meta?: ActorMeta): Promise<void> {
  const po = await loadPoOrThrow(id);

  await db.transaction(async (tx) => {
    await revokeActiveTokens(tx, poSupplierAccess, eq(poSupplierAccess.purchaseOrderId, id));
    await emitOrderEvent(tx, {
      aggregateId: po.orderId,
      eventType: 'supplier_link.revoked',
      payload: { poId: id, poNumber: po.poNumber },
    });
    await recordAuditEvent(
      {
        aggregateId: po.orderId,
        eventType: 'supplier_link.revoked',
        payload: { poId: id, poNumber: po.poNumber },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );
  });
}

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
  deadlineDate: string | null;
  expectedShipDate: string | null;
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
/**
 * The files that ride the supplier email alongside the PDF: uploaded assets
 * (fonts, design files) and the size charts each garment cuts to.
 *
 * From the SNAPSHOT, not the live rows — the email must match the document of
 * record. As actual attachments, not signed URLs, because a URL in a sent
 * email expires and the factory opens these weeks later.
 *
 * A file that cannot be fetched is skipped with a warning rather than failing
 * the send: the PDF itself is the contract, the attachments are supporting
 * material, and blocking a PO on a single unreadable object helps nobody. The
 * PDF names every file it expects, so a gap is visible to the recipient too.
 */
async function collectSnapshotAttachments(
  snapshot: PoSnapshot,
): Promise<{ filename: string; content: Buffer }[]> {
  const wanted = new Map<string, string>(); // storageKey -> filename

  for (const asset of snapshot.assets ?? []) {
    if (asset.storageKey) {
      const ext = asset.storageKey.split('.').pop() ?? 'bin';
      wanted.set(asset.storageKey, `${asset.name}.${ext}`);
    }
  }
  // Charts dedupe across garments — two garments cutting to the same chart
  // should not attach it twice.
  for (const garment of snapshot.garments) {
    for (const chart of garment.sizeCharts ?? []) {
      if (chart.storageKey && !wanted.has(chart.storageKey)) {
        const ext = chart.storageKey.split('.').pop() ?? 'bin';
        wanted.set(chart.storageKey, `size-chart-${chart.name}.${ext}`);
      }
    }
  }

  const attachments: { filename: string; content: Buffer }[] = [];
  for (const [key, filename] of wanted) {
    try {
      attachments.push({ filename, content: await getFileBuffer(key) });
    } catch (err) {
      logger.warn('[po/send] attachment skipped — could not read from storage', { key, filename, err });
    }
  }
  return attachments;
}

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
  if (po.status !== 'draft' && po.status !== 'sent') {
    throw new ConflictError(`Cannot send a ${po.status} purchase order`);
  }
  const supplierEmail = po.supplier.email;
  if (!supplierEmail) throw new ConflictError('Supplier has no email address');

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
    deadlineDate: po.deadlineDate,
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

  // Mint a fresh supplier portal link on every send (see generateSupplierPortalLink
  // doc comment for the "always rotate" tradeoff) so the email always carries a
  // working link, whether this is the first send or a resend after a revision.
  const portalUrl = await generateSupplierPortalLink(id, meta);

  await sendSupplierPoEmail({
    to: supplierEmail,
    toName: po.supplier.contactPerson ?? po.supplier.name,
    poNumber: po.poNumber,
    orderNumber: po.order.orderNumber,
    revisionNumber: latest.revisionNumber,
    reason: latest.reason,
    pdf,
    portalUrl,
    extraAttachments: await collectSnapshotAttachments(latest.snapshot),
  });

  // First send moves draft → sent via the normal status machine (sentAt stamp
  // + status_changed event). A resend leaves the status untouched.
  if (po.status === 'draft') {
    await updatePurchaseOrderStatus(id, 'sent', meta);
  }

  const payload = {
    poId: id,
    poNumber: po.poNumber,
    revisionNumber: latest.revisionNumber,
    to: supplierEmail,
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

  return { poNumber: po.poNumber, to: supplierEmail };
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
    { orderNumber: order.orderNumber, reprintOfOrderNumber: order.sourceOrder?.orderNumber ?? null },
    selected,
    await loadPoAssets(order.id),
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
