/**
 * Shipment service — the single place shipments are created and mutated
 * (PO_PLAN). Mirrors the purchase-orders seam: validation, status-machine
 * guarding, and event emission live here; routes and UI call these functions
 * and never write the shipment tables directly.
 *
 * Event/audit fan-out: a shipment has no aggregate of its own in the outbox —
 * it hangs off the parent ORDERS of its attached POs. Every mutation emits on
 * each affected order so each order's timeline shows its goods moving:
 *  - create / status change: one event + audit row PER ATTACHED PO, on that
 *    PO's parent order (payload carries poId/poNumber so an order with two
 *    POs in the same shipment sees both).
 *  - field updates: one event + audit row per DISTINCT parent order (the
 *    change isn't PO-specific).
 *  - attach/detach: audit row on the affected PO's parent order.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  purchaseOrders,
  shipmentPurchaseOrders,
  shipments,
  suppliers,
} from '@/db/schema';
import { pickDefined } from '@/lib/patch';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';
import { ConflictError, NotFoundError } from '@/server/orders/service';
import {
  canTransitionShipment,
  type CreateShipmentInput,
  type ShipmentStatus,
  type UpdateShipmentInput,
} from './contract';

/** Actor attribution for audit rows + createdBy stamps. */
export interface ActorMeta {
  actorStaffUserId?: string | null;
  actorEmail?: string | null;
}

/** A PO loaded with the parent-order columns the event fan-out needs. */
interface AttachedPo {
  id: string;
  poNumber: string;
  status: string;
  supplierId: string;
  order: { id: string; orderNumber: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadShipmentOrThrow(id: string) {
  const shipment = await db.query.shipments.findFirst({ where: eq(shipments.id, id) });
  if (!shipment) throw new NotFoundError('Shipment');
  return shipment;
}

/**
 * Load POs by id, requiring that every id exists and belongs to the given
 * supplier — a shipment is a single physical consignment from ONE factory,
 * so cross-supplier POs can never share one.
 */
async function loadPosForSupplier(poIds: string[], supplierId: string): Promise<AttachedPo[]> {
  const uniqueIds = [...new Set(poIds)];
  const pos = await db.query.purchaseOrders.findMany({
    where: inArray(purchaseOrders.id, uniqueIds),
    columns: { id: true, poNumber: true, status: true, supplierId: true },
    with: { order: { columns: { id: true, orderNumber: true } } },
  });
  if (pos.length !== uniqueIds.length) throw new NotFoundError('Purchase order');
  for (const po of pos) {
    if (po.supplierId !== supplierId) {
      throw new ConflictError(`Purchase order ${po.poNumber} belongs to a different supplier`);
    }
  }
  // Preserve the caller's ordering.
  const byId = new Map(pos.map((po) => [po.id, po]));
  return uniqueIds.map((id) => byId.get(id)!);
}

/** The attached POs of a shipment, with parent-order columns for fan-out. */
async function loadAttachedPos(shipmentId: string): Promise<AttachedPo[]> {
  const links = await db.query.shipmentPurchaseOrders.findMany({
    where: eq(shipmentPurchaseOrders.shipmentId, shipmentId),
    with: {
      purchaseOrder: {
        columns: { id: true, poNumber: true, status: true, supplierId: true },
        with: { order: { columns: { id: true, orderNumber: true } } },
      },
    },
  });
  return links.map((l) => l.purchaseOrder);
}

/** drizzle numeric columns travel as strings — normalize the Zod number. */
function toNumericString(value: number | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : value.toFixed(2);
}

function toPoSummary(po: AttachedPo) {
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    orderId: po.order.id,
    orderNumber: po.order.orderNumber,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createShipment(input: CreateShipmentInput, meta?: ActorMeta) {
  const supplier = await db.query.suppliers.findFirst({
    where: eq(suppliers.id, input.supplierId),
  });
  if (!supplier) throw new NotFoundError('Supplier');
  if (!supplier.isActive) throw new ConflictError('Supplier is inactive');

  const pos = await loadPosForSupplier(input.purchaseOrderIds, supplier.id);

  const shipment = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(shipments)
      .values({
        supplierId: supplier.id,
        nickname: input.nickname ?? null,
        carrier: input.carrier ?? null,
        trackingNumber: input.trackingNumber ?? null,
        trackingUrl: input.trackingUrl ?? null,
        boxCount: input.boxCount ?? null,
        pieceCount: input.pieceCount ?? null,
        shippingCost: toNumericString(input.shippingCost) ?? null,
        shippingCostCurrency: input.shippingCostCurrency,
        etaDate: input.etaDate ?? null,
        notes: input.notes ?? null,
        createdBy: meta?.actorStaffUserId ?? null,
      })
      .returning();

    await tx
      .insert(shipmentPurchaseOrders)
      .values(pos.map((po) => ({ shipmentId: row.id, purchaseOrderId: po.id })));

    for (const po of pos) {
      await emitOrderEvent(tx, {
        aggregateId: po.order.id,
        eventType: 'shipment.created',
        payload: {
          shipmentId: row.id,
          nickname: row.nickname,
          carrier: row.carrier,
          poId: po.id,
          poNumber: po.poNumber,
        },
      });
      await recordAuditEvent(
        {
          aggregateId: po.order.id,
          eventType: 'shipment.created',
          payload: { shipmentId: row.id, nickname: row.nickname, poId: po.id, poNumber: po.poNumber },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }

    return row;
  });

  return { ...shipment, supplier, purchaseOrders: pos.map(toPoSummary) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getShipment(id: string) {
  const shipment = await db.query.shipments.findFirst({
    where: eq(shipments.id, id),
    with: {
      supplier: true,
      purchaseOrderLinks: {
        with: {
          purchaseOrder: {
            columns: { id: true, poNumber: true, status: true, supplierId: true },
            with: { order: { columns: { id: true, orderNumber: true } } },
          },
        },
      },
    },
  });
  if (!shipment) throw new NotFoundError('Shipment');

  const { purchaseOrderLinks, ...rest } = shipment;
  return {
    ...rest,
    purchaseOrders: purchaseOrderLinks.map((l) => toPoSummary(l.purchaseOrder)),
  };
}

export async function listShipments(opts?: {
  status?: ShipmentStatus;
  supplierId?: string;
  search?: string;
}) {
  const conditions = [];
  if (opts?.status) conditions.push(eq(shipments.status, opts.status));
  if (opts?.supplierId) conditions.push(eq(shipments.supplierId, opts.supplierId));

  const rows = await db.query.shipments.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(shipments.createdAt)],
    with: {
      supplier: { columns: { id: true, name: true } },
      purchaseOrderLinks: {
        with: { purchaseOrder: { columns: { id: true, poNumber: true } } },
      },
    },
  });

  // The list is small (one row per consignment) and the search needs to reach
  // across the joined PO numbers, so the free-text filter runs in JS rather
  // than as a SQL ilike over an aggregated join.
  const term = opts?.search?.trim().toLowerCase();
  const mapped = rows.map((row) => {
    const { purchaseOrderLinks, supplier, ...rest } = row;
    return {
      ...rest,
      supplierName: supplier.name,
      poCount: purchaseOrderLinks.length,
      poNumbers: purchaseOrderLinks.map((l) => l.purchaseOrder.poNumber),
    };
  });
  if (!term) return mapped;
  return mapped.filter((row) =>
    [row.nickname, row.carrier, row.trackingNumber, row.supplierName, ...row.poNumbers].some(
      (v) => v?.toLowerCase().includes(term),
    ),
  );
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/** Fields only — status goes through setShipmentStatus, POs through attach/detach. */
export async function updateShipment(id: string, patch: UpdateShipmentInput, meta?: ActorMeta) {
  await loadShipmentOrThrow(id);
  const attached = await loadAttachedPos(id);

  const { shippingCost, ...restPatch } = pickDefined(patch);
  const defined = {
    ...restPatch,
    ...(shippingCost !== undefined ? { shippingCost: toNumericString(shippingCost) } : {}),
  };
  const fields = Object.keys(defined);

  await db.transaction(async (tx) => {
    if (fields.length > 0) {
      await tx
        .update(shipments)
        .set({ ...defined, updatedAt: new Date() })
        .where(eq(shipments.id, id));
    }

    // Fan-out per distinct parent order — a field edit isn't PO-specific.
    const orderIds = [...new Set(attached.map((po) => po.order.id))];
    for (const orderId of orderIds) {
      await emitOrderEvent(tx, {
        aggregateId: orderId,
        eventType: 'shipment.updated',
        payload: { shipmentId: id, fields },
      });
      await recordAuditEvent(
        {
          aggregateId: orderId,
          eventType: 'shipment.updated',
          payload: { shipmentId: id, fields },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }
  });

  return getShipment(id);
}

export async function setShipmentStatus(id: string, next: ShipmentStatus, meta?: ActorMeta) {
  const shipment = await loadShipmentOrThrow(id);
  const from = shipment.status;
  if (!canTransitionShipment(from, next)) {
    throw new ConflictError(`Cannot move a ${from} shipment to ${next}`);
  }

  const attached = await loadAttachedPos(id);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(shipments)
      .set({
        status: next,
        // shippedAt marks the FIRST entry into transit — a delayed/exception
        // round-trip back to in_transit must not overwrite it.
        ...(next === 'in_transit' && shipment.shippedAt === null ? { shippedAt: now } : {}),
        ...(next === 'delivered' ? { deliveredAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(shipments.id, id));

    // NOTE: delivery does NOT auto-move the attached POs to 'received' —
    // receiving is an explicit staff action on each PO (goods are checked in
    // per PO, and a delivered box can still be short or wrong).
    for (const po of attached) {
      await emitOrderEvent(tx, {
        aggregateId: po.order.id,
        eventType: 'shipment.status_changed',
        payload: { shipmentId: id, from, to: next, poId: po.id, poNumber: po.poNumber },
      });
      await recordAuditEvent(
        {
          aggregateId: po.order.id,
          eventType: 'shipment.status_changed',
          payload: { shipmentId: id, from, to: next, poId: po.id, poNumber: po.poNumber },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }
  });

  return getShipment(id);
}

// ---------------------------------------------------------------------------
// Attach / detach purchase orders
// ---------------------------------------------------------------------------

export async function attachPurchaseOrders(id: string, poIds: string[], meta?: ActorMeta) {
  const shipment = await loadShipmentOrThrow(id);
  const pos = await loadPosForSupplier(poIds, shipment.supplierId);

  const existing = await db.query.shipmentPurchaseOrders.findMany({
    where: eq(shipmentPurchaseOrders.shipmentId, id),
    columns: { purchaseOrderId: true },
  });
  const existingIds = new Set(existing.map((l) => l.purchaseOrderId));
  if (pos.some((po) => existingIds.has(po.id))) {
    throw new ConflictError('Purchase order is already attached');
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(shipmentPurchaseOrders)
      .values(pos.map((po) => ({ shipmentId: id, purchaseOrderId: po.id })));

    for (const po of pos) {
      await recordAuditEvent(
        {
          aggregateId: po.order.id,
          eventType: 'shipment.updated',
          payload: { shipmentId: id, action: 'po_attached', poId: po.id, poNumber: po.poNumber },
          actorEmail: meta?.actorEmail ?? null,
        },
        tx,
      );
    }
  });

  return getShipment(id);
}

export async function detachPurchaseOrder(id: string, poId: string, meta?: ActorMeta) {
  await loadShipmentOrThrow(id);

  const attached = await loadAttachedPos(id);
  const po = attached.find((p) => p.id === poId);
  if (!po) throw new NotFoundError('Attached purchase order');

  await db.transaction(async (tx) => {
    await tx
      .delete(shipmentPurchaseOrders)
      .where(
        and(
          eq(shipmentPurchaseOrders.shipmentId, id),
          eq(shipmentPurchaseOrders.purchaseOrderId, poId),
        ),
      );

    await recordAuditEvent(
      {
        aggregateId: po.order.id,
        eventType: 'shipment.updated',
        payload: { shipmentId: id, action: 'po_detached', poId: po.id, poNumber: po.poNumber },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );
  });

  return getShipment(id);
}
