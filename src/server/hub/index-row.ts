/**
 * The canonical order INDEX ROW — FLEET_STANDARD_ANNOTATIONS §7, the
 * one-serializer rule: this single serializer feeds BOTH transports — the hub
 * push (order-sync.ts register/PATCH, layer 2) and the full-state
 * orders-by-customer capability GET that the hub's read-repair consumes
 * (layer 3). If the two paths cannot disagree, repair cannot fight push.
 *
 * Includes the PO summary block (David, 2026-08-04: sales staff need each
 * order's POs — status, when each status changed, projected ship date).
 * PO data is STAFF-ONLY: the hub must never surface `pos` on any
 * customer-visible rendering; supplier visibility is a different, adjacent
 * machinery and does not apply here.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import { domainEvents, orders, purchaseOrders, suppliers } from '@/db/schema';
import { env } from '@/lib/env';
import { aggregateProductionStatus } from '@/server/purchase-orders/hub-sync';

/**
 * The pinned chip vocabulary (fleet thread):
 * draft | sent | viewed | changes_requested | confirmed | in_production |
 * completed | cancelled.
 */
export type OrderIndexChip =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'changes_requested'
  | 'confirmed'
  | 'in_production'
  | 'completed'
  | 'cancelled';

/**
 * Map order status + PO statuses onto the display chip.
 *
 * The order enum verbatim until `confirmed`; once confirmed, the aggregate
 * production status takes over — least-advanced non-cancelled PO wins, so
 * `completed` is only reachable when every PO is. Aggregate stages before
 * production starts still read `confirmed` (POs being drafted is not
 * "in production" to a salesperson), and everything from pre-production to
 * received reads `in_production` — the CRM chip answers "where is it", not
 * "which internal stage".
 */
export function orderIndexChip(orderStatus: string, poStatuses: string[]): OrderIndexChip | null {
  if (orderStatus !== 'confirmed') {
    const direct = ['draft', 'sent', 'viewed', 'changes_requested', 'cancelled'];
    return direct.includes(orderStatus) ? (orderStatus as OrderIndexChip) : null;
  }

  const aggregate = aggregateProductionStatus(poStatuses);
  if (aggregate === null) return 'confirmed'; // no active POs yet
  if (aggregate === 'completed') return 'completed';
  if (['pre_production', 'in_production', 'in_transit', 'received'].includes(aggregate)) {
    return 'in_production';
  }
  // POs exist but are still draft/sent/confirmed — production has not started.
  return 'confirmed';
}

export interface PoSummary {
  id: string;
  poNumber: string;
  status: string;
  /** Creation (always 'draft') plus every transition, oldest first. */
  statusHistory: { status: string; at: string }[];
  /** The projected shipping date staff quote from. */
  expectedShipDate: string | null;
  actualShipDate: string | null;
  supplierName: string | null;
}

export interface OrderIndexRow {
  /** Our order uuid — the stable row identity diff-apply keys on. */
  externalId: string;
  orderNumber: string;
  /** Display label: the order's own name, else club, else person (register semantics). */
  name: string;
  status: string;
  orderValue: number | null;
  currency: string | null;
  url: string;
  /** STAFF-ONLY (see header). */
  pos: PoSummary[];
}

type OrderRow = typeof orders.$inferSelect;

/**
 * Serialize index rows for a set of orders, batched (two queries however many
 * orders). Takes an executor because outbox handlers pass their batch tx.
 */
export async function buildOrderIndexRows(
  orderRows: OrderRow[],
  executor?: Transaction,
): Promise<OrderIndexRow[]> {
  const ex = executor ?? db;
  if (orderRows.length === 0) return [];
  const orderIds = orderRows.map((o) => o.id);

  const pos = await ex
    .select({
      id: purchaseOrders.id,
      orderId: purchaseOrders.orderId,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      expectedShipDate: purchaseOrders.expectedShipDate,
      actualShipDate: purchaseOrders.actualShipDate,
      createdAt: purchaseOrders.createdAt,
      supplierName: suppliers.name,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(inArray(purchaseOrders.orderId, orderIds));

  // Status-change moments come from the outbox trail (po.status_changed is
  // emitted in the same tx as every transition), not a bespoke history table.
  const transitions = await ex
    .select({
      aggregateId: domainEvents.aggregateId,
      payload: domainEvents.payload,
      createdAt: domainEvents.createdAt,
    })
    .from(domainEvents)
    .where(and(eq(domainEvents.eventType, 'po.status_changed'), inArray(domainEvents.aggregateId, orderIds)))
    .orderBy(asc(domainEvents.createdAt));

  const historyByPo = new Map<string, { status: string; at: string }[]>();
  for (const t of transitions) {
    const p = t.payload as { poId?: string; to?: string };
    if (!p.poId || !p.to) continue;
    const list = historyByPo.get(p.poId) ?? [];
    list.push({ status: p.to, at: t.createdAt.toISOString() });
    historyByPo.set(p.poId, list);
  }

  return orderRows.map((order) => {
    const orderPos = pos.filter((p) => p.orderId === order.id);
    const chip = orderIndexChip(order.status, orderPos.map((p) => p.status));
    const orderValue = order.orderValueAmount !== null ? Number(order.orderValueAmount) : null;
    return {
      externalId: order.id,
      orderNumber: order.orderNumber,
      name: order.name ?? order.clubName ?? order.customerName,
      // An unmapped status falls back to the raw value rather than dropping
      // the row: absence from a full-state read means DELETION to diff-apply.
      status: chip ?? order.status,
      orderValue,
      currency: order.orderValueCurrency ?? (orderValue !== null ? 'NZD' : null),
      url: `${env.APP_BASE_URL}/admin/orders/${order.id}`,
      pos: orderPos.map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        status: p.status,
        statusHistory: [
          { status: 'draft', at: p.createdAt.toISOString() },
          ...(historyByPo.get(p.id) ?? []),
        ],
        expectedShipDate: p.expectedShipDate,
        actualShipDate: p.actualShipDate,
        supplierName: p.supplierName ?? null,
      })),
    };
  });
}

/** The full-state list for one hub customer — what read-repair consumes. */
export async function listOrderIndexRowsForCustomer(
  hubCustomerId: string,
): Promise<OrderIndexRow[]> {
  const rows = await db.select().from(orders).where(eq(orders.hubCustomerId, hubCustomerId));
  return buildOrderIndexRows(rows);
}
