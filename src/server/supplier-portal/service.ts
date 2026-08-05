/**
 * Supplier portal service — TWO gates, one read model.
 *
 * Gate 1 (legacy, still served): per-PO magic-link token (`/s/[token]`), no
 * session, raw token per request — links already in supplier inboxes keep
 * working forever. Gate 2 (David, 2026-08-05): per-SUPPLIER password portal
 * (`/supplier/[code]`) — a signed cookie (src/lib/supplier-session.ts) proves
 * supplier + self-asserted person name, and every PO of that supplier is
 * reachable by its number. Both gates converge on the same view builder and
 * the same mutation paths, so there is one status machine and one comment
 * model regardless of how the supplier arrived.
 *
 * The read model is the PO's own `PoSnapshot` — already "the immutable content
 * of what the supplier was sent". Comments reuse order_notes (authorKind:
 * 'supplier', always visibility: 'shared').
 *
 * The CUSTOMER deadline (po.deadlineDate mirrors orders.deadlineDate since
 * 2026-08-05) is deliberately ABSENT from everything this file returns — it
 * must never reach the supplier.
 */
import { and, eq, notInArray } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@/db';
import { poSupplierAccess, purchaseOrders, suppliers } from '@/db/schema';
import type { PoSnapshot } from '@/db/schema';
import { resolveActiveToken } from '@/server/access/tokens';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { addOrderNote, listOrderNotes, type OrderNoteDto } from '@/server/orders/notes-service';
import { canTransition, type PoStatus } from '@/server/purchase-orders/contract';
import { updatePurchaseOrderStatusTx } from '@/server/purchase-orders/service';
import { syncOrderProductionStatus } from '@/server/purchase-orders/hub-sync';
import { signPoAssets, signPoSnapshotMedia } from '@/lib/signed-urls';
import { SUPPLIER_ALLOWED_STATUSES, type SupplierAllowedStatus } from './contract';

export interface SupplierPortalViewDto {
  poId: string;
  poNumber: string;
  status: PoStatus;
  /** Statuses this supplier may set from the current status, in chain order. */
  allowedNextStatuses: SupplierAllowedStatus[];
  expectedShipDate: string | null;
  actualShipDate: string | null;
  sentAt: string | null;
  notes: string | null;
  supplier: {
    name: string;
    contactPerson: string | null;
    email: string | null;
    phone: string | null;
  };
  revisionNumber: number;
  snapshot: PoSnapshot;
  comments: OrderNoteDto[];
}

/** One row of the supplier's PO table (/supplier/[code]). */
export interface SupplierPoListRow {
  poId: string;
  poNumber: string;
  status: PoStatus;
  allowedNextStatuses: SupplierAllowedStatus[];
  expectedShipDate: string | null;
  actualShipDate: string | null;
  sentAt: string | null;
  revisionNumber: number;
  /** Garment names off the latest snapshot — enough for the table without a click. */
  garmentNames: string[];
  totalUnits: number;
}

// ---------------------------------------------------------------------------
// Gate 1 — the legacy per-PO token
// ---------------------------------------------------------------------------

async function resolveAccessOrThrow(rawToken: string) {
  const access = await resolveActiveToken(poSupplierAccess, rawToken);
  if (!access) throw new Error('invalid_token');
  return access;
}

// ---------------------------------------------------------------------------
// Gate 2 — the per-supplier password portal
// ---------------------------------------------------------------------------

/**
 * The supplier a portal code names, or null. Codes are stored uppercase
 * (supplierCodeSchema uppercases on write); the URL match is case-insensitive
 * so /supplier/dy works. Only suppliers with a STORED code have a portal —
 * the numbering fallback code is derived, never stored, and cannot be a URL.
 */
export async function getSupplierByPortalCode(code: string) {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return null;
  const supplier = await db.query.suppliers.findFirst({
    where: eq(suppliers.supplierCode, wanted),
  });
  return supplier ?? null;
}

/**
 * Password check for the portal gate. Constant-time compare; a supplier with
 * no portalPassword set has a CLOSED portal (David: admin sets the password —
 * no password, no portal), which reads the same as a wrong password so the
 * gate does not reveal which suppliers exist.
 */
export function supplierPasswordMatches(
  supplier: { portalPassword: string | null; isActive: boolean },
  password: string,
): boolean {
  if (!supplier.isActive || !supplier.portalPassword || !password) return false;
  const expected = Buffer.from(supplier.portalPassword, 'utf8');
  const actual = Buffer.from(password, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Load a PO by NUMBER and verify it belongs to this supplier and has been sent. */
async function loadSupplierPoOrThrow(supplierId: string, poNumber: string) {
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.poNumber, poNumber),
    with: {
      supplier: true,
      revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)], limit: 1 },
    },
  });
  // Draft/approved = not yet sent — invisible on the portal (David,
  // 2026-08-05), indistinguishable from absent. Wrong supplier likewise: a
  // valid session for DY must not confirm that GOAL's numbers exist.
  if (!po || po.supplierId !== supplierId || po.status === 'draft' || po.status === 'approved') {
    throw new Error('po_not_found');
  }
  return po;
}

/** Every sent PO of one supplier, newest first — the portal table. */
export async function listSupplierPos(supplierId: string): Promise<SupplierPoListRow[]> {
  const rows = await db.query.purchaseOrders.findMany({
    // Unsent POs (draft, approved) never reach the supplier's list.
    where: and(
      eq(purchaseOrders.supplierId, supplierId),
      notInArray(purchaseOrders.status, ['draft', 'approved']),
    ),
    orderBy: (po, { desc }) => [desc(po.createdAt)],
    with: { revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)], limit: 1 } },
  });
  return rows.map((po) => {
    const snapshot = po.revisions[0]?.snapshot;
    const garmentsInPo = snapshot?.garments ?? [];
    return {
      poId: po.id,
      poNumber: po.poNumber,
      status: po.status,
      allowedNextStatuses: SUPPLIER_ALLOWED_STATUSES.filter((t) => canTransition(po.status, t)),
      expectedShipDate: po.expectedShipDate,
      actualShipDate: po.actualShipDate,
      sentAt: po.sentAt ? po.sentAt.toISOString() : null,
      revisionNumber: po.currentRevisionNumber,
      garmentNames: garmentsInPo.map((g) => g.name),
      totalUnits: garmentsInPo.reduce(
        (sum, g) => sum + g.lines.reduce((s, l) => s + (l.quantity ?? 1), 0),
        0,
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// The shared view builder
// ---------------------------------------------------------------------------

type PortalPo = NonNullable<Awaited<ReturnType<typeof loadSupplierPoOrThrow>>>;

async function buildPortalView(po: PortalPo): Promise<SupplierPortalViewDto> {
  const latest = po.revisions[0]; // rev 1 always exists
  const comments = await listOrderNotes(po.orderId, 'order', { visibility: 'shared' });

  // Signed here, per request — the stored snapshot only ever keeps the
  // storageKey, so nothing durable holds a URL that can expire. Media covers
  // garment mock-up images AND size charts (David, 2026-08-05: the supplier
  // PO shows everything they need to make the order exactly as specified).
  const withAssets: PoSnapshot = latest.snapshot.assets?.length
    ? { ...latest.snapshot, assets: await signPoAssets(latest.snapshot.assets) }
    : latest.snapshot;
  const snapshot = await signPoSnapshotMedia(withAssets);

  return {
    poId: po.id,
    poNumber: po.poNumber,
    status: po.status,
    allowedNextStatuses: SUPPLIER_ALLOWED_STATUSES.filter((target) =>
      canTransition(po.status, target),
    ),
    expectedShipDate: po.expectedShipDate,
    actualShipDate: po.actualShipDate,
    sentAt: po.sentAt ? po.sentAt.toISOString() : null,
    notes: po.notes,
    supplier: {
      name: po.supplier.name,
      contactPerson: po.supplier.contactPerson,
      email: po.supplier.email,
      phone: po.supplier.phone,
    },
    revisionNumber: latest.revisionNumber,
    snapshot,
    comments,
  };
}

/**
 * Read the portal view for a token, and stamp `lastViewedAt` on the access row
 * — the same "viewed" tracking `order_access` already does.
 */
export async function resolveSupplierPortalView(rawToken: string): Promise<SupplierPortalViewDto> {
  const access = await resolveAccessOrThrow(rawToken);
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, access.purchaseOrderId),
    with: {
      supplier: true,
      revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)], limit: 1 },
    },
  });
  // The PO a live access row points at is never missing — access rows cascade
  // on PO delete — but the type is nullable, so guard rather than assert.
  if (!po) throw new Error('invalid_token');

  await db
    .update(poSupplierAccess)
    .set({ lastViewedAt: new Date() })
    .where(eq(poSupplierAccess.id, access.id));

  return buildPortalView(po);
}

/** The portal view for the password-gated surface, by PO number. */
export async function resolveSupplierPoViewByNumber(
  supplierId: string,
  poNumber: string,
): Promise<SupplierPortalViewDto> {
  const po = await loadSupplierPoOrThrow(supplierId, poNumber);
  return buildPortalView(po);
}

// ---------------------------------------------------------------------------
// Mutations — shared core, entered from either gate
// ---------------------------------------------------------------------------

type PoForMutation = {
  id: string;
  orderId: string;
  poNumber: string;
  status: PoStatus;
  sentAt: Date | null;
  receivedAt: Date | null;
  supplier: { id: string; name: string };
};

/**
 * Move a PO forward through the supplier-safe subset of the status machine.
 *
 * Rejects any target outside `SUPPLIER_ALLOWED_STATUSES` BEFORE consulting
 * `canTransition`, so the error a supplier sees is "you can't set that status"
 * rather than a generic transition failure. Delegates the actual write to
 * `updatePurchaseOrderStatusTx` — the same function staff mutations use — so
 * there is one status machine and one set of side effects, not a parallel
 * supplier-only code path.
 *
 * Excluded on purpose:
 *  - `sent` — that's staff re-sending after a revision, not a shop-floor update.
 *  - `received` / `completed` — the physical-goods checkpoint (David's
 *    2026-08-05 ruling: ours, not the supplier's claim).
 *  - `cancelled` / `remake` — business decisions with cost implications; a
 *    supplier requests these via comment, not self-serve.
 *
 * `actorLabel` is who did it, for the audit trail — "Ana (Dynasty)" from the
 * password portal, or "Dynasty (supplier portal)" from a legacy token link.
 */
async function applySupplierStatusChange(
  po: PoForMutation,
  status: SupplierAllowedStatus,
  actorLabel: string,
): Promise<{ poId: string; poNumber: string; status: PoStatus }> {
  if (!canTransition(po.status, status)) {
    throw new Error('illegal_transition');
  }

  const updated = await db.transaction(async (tx) => {
    const row = await updatePurchaseOrderStatusTx(tx, po, status);

    // Distinct from the po.status_changed event updatePurchaseOrderStatusTx
    // already emitted — this one carries supplier attribution so notification
    // routing (po.supplier_updated in the catalog) can tell a supplier did
    // this apart from staff, and the Audit Log can attribute it correctly.
    await emitOrderEvent(tx, {
      aggregateId: po.orderId,
      eventType: 'po.supplier_updated',
      payload: {
        poId: po.id,
        poNumber: po.poNumber,
        from: po.status,
        to: status,
        supplierId: po.supplier.id,
        supplierName: po.supplier.name,
        actorLabel,
      },
    });
    // aggregateType defaults to 'order' (not 'purchase_order') on purpose —
    // getOrderAuditLog filters strictly on aggregateType: 'order', matching
    // every other PO audit call in purchase-orders/service.ts, so this shows
    // in the order's Audit Log tab rather than silently going nowhere.
    await recordAuditEvent(
      {
        aggregateId: po.orderId,
        eventType: 'po.supplier_updated',
        payload: { poId: po.id, poNumber: po.poNumber, from: po.status, to: status },
        actorEmail: actorLabel,
      },
      tx,
    );

    return row;
  });

  // Fire-and-forget hub write-back AFTER commit, same as the staff-driven path.
  void syncOrderProductionStatus(po.orderId);

  return { poId: po.id, poNumber: po.poNumber, status: updated.status };
}

/** Gate-1 (token) status change — label falls back to the supplier's name. */
export async function updateSupplierPoStatus(
  rawToken: string,
  status: SupplierAllowedStatus,
): Promise<{ poId: string; poNumber: string; status: PoStatus }> {
  if (!SUPPLIER_ALLOWED_STATUSES.includes(status)) {
    throw new Error('status_not_allowed');
  }
  const access = await resolveAccessOrThrow(rawToken);
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, access.purchaseOrderId),
    with: { supplier: { columns: { id: true, name: true } } },
  });
  if (!po) throw new Error('invalid_token');
  return applySupplierStatusChange(po, status, `${po.supplier.name} (supplier portal)`);
}

/** Gate-2 (password portal) status change, by PO number, with the person's name. */
export async function updateSupplierPoStatusByNumber(
  supplier: { id: string; name: string },
  poNumber: string,
  status: SupplierAllowedStatus,
  personName: string,
): Promise<{ poId: string; poNumber: string; status: PoStatus }> {
  if (!SUPPLIER_ALLOWED_STATUSES.includes(status)) {
    throw new Error('status_not_allowed');
  }
  const po = await loadSupplierPoOrThrow(supplier.id, poNumber);
  return applySupplierStatusChange(po, status, `${personName} (${supplier.name})`);
}

/**
 * The supplier sets or moves their expected ship date (David, 2026-08-05:
 * "the supplier MUST be able to set and change an expected shipping date").
 * Audited with the same who/when discipline as status changes — the record of
 * a slipping date is exactly what production management needs to see.
 */
export async function updateSupplierPoShipDate(
  supplier: { id: string; name: string },
  poNumber: string,
  expectedShipDate: string,
  personName: string,
): Promise<{ poId: string; poNumber: string; expectedShipDate: string }> {
  const po = await loadSupplierPoOrThrow(supplier.id, poNumber);
  // David, 2026-08-05: the supplier cannot affect anything after SHIPPING.
  // (Status changes are already safe — no supplier-allowed target sits past
  // in_transit and the chain has no backward moves — but the ship date needs
  // this explicit lock.)
  if (['in_transit', 'received', 'completed', 'remake', 'cancelled'].includes(po.status)) {
    throw new Error('locked_after_shipping');
  }
  const actorLabel = `${personName} (${supplier.name})`;

  await db.transaction(async (tx) => {
    await tx
      .update(purchaseOrders)
      .set({ expectedShipDate, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, po.id));

    await emitOrderEvent(tx, {
      aggregateId: po.orderId,
      eventType: 'po.supplier_updated',
      payload: {
        poId: po.id,
        poNumber: po.poNumber,
        field: 'expectedShipDate',
        from: po.expectedShipDate,
        to: expectedShipDate,
        supplierId: supplier.id,
        supplierName: supplier.name,
        actorLabel,
      },
    });
    await recordAuditEvent(
      {
        aggregateId: po.orderId,
        eventType: 'po.ship_date_changed',
        payload: {
          poId: po.id,
          poNumber: po.poNumber,
          from: po.expectedShipDate,
          to: expectedShipDate,
        },
        actorEmail: actorLabel,
      },
      tx,
    );
  });

  return { poId: po.id, poNumber: po.poNumber, expectedShipDate };
}

/** A supplier's comment. Always order-level and always 'shared' — see notes-service.ts. */
export async function addSupplierComment(rawToken: string, body: string): Promise<OrderNoteDto> {
  const access = await resolveAccessOrThrow(rawToken);
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, access.purchaseOrderId),
    with: { supplier: { columns: { name: true } } },
  });
  if (!po) throw new Error('invalid_token');

  return addOrderNote(po.orderId, {
    body,
    authorKind: 'supplier',
    authorLabel: `${po.supplier.name} (${po.poNumber})`,
    garmentId: null,
  });
}

/** Gate-2 comment, attributed to the named person. */
export async function addSupplierCommentByNumber(
  supplier: { id: string; name: string },
  poNumber: string,
  body: string,
  personName: string,
): Promise<OrderNoteDto> {
  const po = await loadSupplierPoOrThrow(supplier.id, poNumber);
  return addOrderNote(po.orderId, {
    body,
    authorKind: 'supplier',
    authorLabel: `${personName} (${supplier.name}, ${po.poNumber})`,
    garmentId: null,
  });
}
