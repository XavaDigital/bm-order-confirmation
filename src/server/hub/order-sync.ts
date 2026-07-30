/**
 * Order → hub index synchronisation (fleet thread 2026-07-31-orders-from-email).
 *
 * The hub keeps a THIN display row per order (status chip + value + deep
 * link); bm-orders owns everything else. This module computes the chip and
 * pushes the snapshot. It is driven from TWO places, deliberately:
 *
 *  - the OUTBOX handler, registered for every order/PO lifecycle event — the
 *    "by construction" choke point (designflow's D1 lesson: wire the push at
 *    the effects layer, or call sites forget), with retry giving at-least-once;
 *  - a post-commit fire-and-forget on order CREATE, which emits no outbox
 *    event today.
 *
 * Both push the same snapshot, so double-firing is harmless by design.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import { orders, purchaseOrders } from '@/db/schema';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { isHubConfigured, patchHubOrder, registerHubOrder } from './client';
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

/**
 * Push one order's snapshot to the hub index. Never throws unless `strict` —
 * outbox handlers pass strict so a failed push retries with backoff; the
 * post-commit create path stays fire-and-forget.
 *
 * Takes an optional executor because outbox handlers run inside the batch
 * transaction and MUST NOT touch the global db (PGlite single-connection
 * deadlock — see EventHandler's contract).
 */
export async function syncOrderIndexToHub(
  orderId: string,
  opts: { executor?: Transaction; strict?: boolean } = {},
): Promise<void> {
  const ex = opts.executor ?? db;
  try {
    if (!isHubConfigured()) return;

    const [order] = await ex.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return;
    // David's ruling: orders should never lack a hub customer — but the seam
    // can be off (standalone) and legacy rows exist. Nothing to index under.
    if (!order.hubCustomerId) return;

    const pos = await ex
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.orderId, orderId));

    const chip = orderIndexChip(order.status, pos.map((p) => p.status));
    if (chip === null) {
      logger.warn('[hub/order-sync] unmapped status — pushing nothing rather than lying', {
        orderId,
        status: order.status,
      });
      return;
    }

    const url = `${env.APP_BASE_URL}/admin/orders/${order.id}`;
    // David's ruling: value is ungated on the CRM.
    const orderValue = order.orderValueAmount !== null ? Number(order.orderValueAmount) : null;
    const currency = order.orderValueCurrency ?? (orderValue !== null ? 'NZD' : null);

    if (!order.hubOrderId) {
      const hubOrderId = await registerHubOrder({
        customerId: order.hubCustomerId,
        contactId: order.hubContactId ?? null,
        orderNumber: order.orderNumber,
        status: chip,
        orderValue,
        currency,
        externalId: order.id,
        url,
      });
      if (!hubOrderId) {
        if (opts.strict) throw new Error('hub order registration failed');
        return;
      }
      // Stamped through the same executor — inside a handler that is the
      // batch tx, which is fine: this is our own row, not a hub read.
      await ex.update(orders).set({ hubOrderId }).where(eq(orders.id, orderId));
      return; // the register carried the full snapshot; no PATCH needed
    }

    const ok = await patchHubOrder(order.hubOrderId, { status: chip, orderValue, currency, url });
    if (!ok && opts.strict) throw new Error('hub order status push failed');
  } catch (err) {
    if (opts.strict) throw err;
    logger.warn('[hub/order-sync] push failed (non-strict)', { orderId, err });
  }
}
