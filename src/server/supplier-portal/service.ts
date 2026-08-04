/**
 * Token-gated supplier portal (SUPPLIER_PORTAL_PLAN.md).
 *
 * Mirrors the shape of src/server/orders/customer-service.ts: no session, a raw
 * token resolved per request, and plain `Error('invalid_token' | ...)` messages
 * that the route layer maps to HTTP status — same convention `/api/o/**`
 * already uses, so the two token-gated surfaces read the same way.
 *
 * The read model is the PO's own `PoSnapshot` — already "the immutable content
 * of what the supplier was sent" (see src/db/schema.ts PoSnapshot doc) — so no
 * new DTO/mapper is needed for garment/sizing content. Comments reuse
 * order_notes (authorKind: 'supplier', always visibility: 'shared').
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { poSupplierAccess, purchaseOrders } from '@/db/schema';
import type { PoSnapshot } from '@/db/schema';
import { resolveActiveToken } from '@/server/access/tokens';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { addOrderNote, listOrderNotes, type OrderNoteDto } from '@/server/orders/notes-service';
import { canTransition, type PoStatus } from '@/server/purchase-orders/contract';
import { updatePurchaseOrderStatusTx } from '@/server/purchase-orders/service';
import { syncOrderProductionStatus } from '@/server/purchase-orders/hub-sync';
import { signPoAssets } from '@/lib/signed-urls';
import { SUPPLIER_ALLOWED_STATUSES, type SupplierAllowedStatus } from './contract';

export interface SupplierPortalViewDto {
  poNumber: string;
  status: PoStatus;
  /** Statuses this supplier may set from the current status, in chain order. */
  allowedNextStatuses: SupplierAllowedStatus[];
  deadlineDate: string | null;
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

async function resolveAccessOrThrow(rawToken: string) {
  const access = await resolveActiveToken(poSupplierAccess, rawToken);
  if (!access) throw new Error('invalid_token');
  return access;
}

async function loadPoForPortal(purchaseOrderId: string) {
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, purchaseOrderId),
    with: {
      supplier: true,
      revisions: { orderBy: (r, { desc }) => [desc(r.revisionNumber)], limit: 1 },
    },
  });
  // The PO a live access row points at is never missing — access rows cascade
  // on PO delete — but the type is nullable, so guard rather than assert.
  if (!po) throw new Error('invalid_token');
  return po;
}

/**
 * Read the portal view for a token, and stamp `lastViewedAt` on the access row
 * — the same "viewed" tracking `order_access` already does.
 */
export async function resolveSupplierPortalView(rawToken: string): Promise<SupplierPortalViewDto> {
  const access = await resolveAccessOrThrow(rawToken);
  const po = await loadPoForPortal(access.purchaseOrderId);
  const latest = po.revisions[0]; // rev 1 always exists

  await db
    .update(poSupplierAccess)
    .set({ lastViewedAt: new Date() })
    .where(eq(poSupplierAccess.id, access.id));

  const comments = await listOrderNotes(po.orderId, 'order', { visibility: 'shared' });

  // Signed here, per request — the stored snapshot only ever keeps the
  // storageKey, so nothing durable holds a URL that can expire.
  const snapshot: PoSnapshot = latest.snapshot.assets?.length
    ? { ...latest.snapshot, assets: await signPoAssets(latest.snapshot.assets) }
    : latest.snapshot;

  return {
    poNumber: po.poNumber,
    status: po.status,
    allowedNextStatuses: SUPPLIER_ALLOWED_STATUSES.filter((target) =>
      canTransition(po.status, target),
    ),
    deadlineDate: po.deadlineDate,
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
 * Move a PO forward through the supplier-safe subset of the status machine.
 *
 * Rejects any target outside `SUPPLIER_ALLOWED_STATUSES` BEFORE consulting
 * `canTransition`, so the error a supplier sees is "you can't set that status"
 * rather than a generic transition failure. Delegates the actual write to
 * `updatePurchaseOrderStatusTx` — the same function staff mutations use — so
 * there is one status machine and one set of side effects (sentAt/receivedAt
 * stamping), not a parallel supplier-only code path.
 *
 * Excluded on purpose:
 *  - `sent` — that's staff re-sending after a revision, not a shop-floor update.
 *  - `received` / `completed` — the physical-QC checkpoint; a supplier's claim
 *    is not the same fact as staff confirming stock arrived and matches the PO.
 *  - `cancelled` / `remake` — business decisions with cost implications; a
 *    supplier requests these via comment, not self-serve.
 */
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
        actorEmail: `${po.supplier.name} (supplier portal)`,
      },
      tx,
    );

    return row;
  });

  // Fire-and-forget hub write-back AFTER commit, same as the staff-driven path.
  void syncOrderProductionStatus(po.orderId);

  return { poId: po.id, poNumber: po.poNumber, status: updated.status };
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
