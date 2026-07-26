/**
 * Dormant Sales Hub production-status write-back (PO_PLAN Phase 6).
 *
 * After a PO status change, the order's AGGREGATE production status is derived
 * from all its non-cancelled POs and pushed to the hub — fire-and-forget, only
 * when the hub is configured AND the order carries an externalRef (a
 * platform-originated order the hub knows about). The hub-side endpoint is a
 * proposal; until bm-sales ships it, pushProductionStatus is a no-op.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, purchaseOrders } from '@/db/schema';
import { isHubConfigured, pushProductionStatus } from '@/server/hub/client';
import { logger } from '@/lib/logger';

/** Ascending progress order for aggregation — least-advanced PO wins. */
const PROGRESS_ORDER = [
  'draft',
  'sent',
  'confirmed',
  'pre_production',
  'in_production',
  'in_transit',
  'received',
  'completed',
] as const;

/**
 * Aggregate one production status across a set of PO statuses:
 * - cancelled POs are ignored (they no longer represent work);
 * - remake ranks as in_production (goods are being made again);
 * - otherwise the least-advanced PO wins — the order is only as far along as
 *   its slowest PO — so "all completed" is the only way to reach completed.
 * Returns null when there is nothing to report (no non-cancelled POs).
 */
export function aggregateProductionStatus(statuses: string[]): string | null {
  const active = statuses
    .filter((s) => s !== 'cancelled')
    .map((s) => (s === 'remake' ? 'in_production' : s));
  if (active.length === 0) return null;

  let least = PROGRESS_ORDER.length - 1;
  for (const s of active) {
    const rank = PROGRESS_ORDER.indexOf(s as (typeof PROGRESS_ORDER)[number]);
    if (rank === -1) return null; // unknown status — report nothing rather than lie
    if (rank < least) least = rank;
  }
  return PROGRESS_ORDER[least];
}

/**
 * Fire-and-forget sync for one order. Never throws; failures are logged.
 * Callers invoke this AFTER their transaction commits (void syncOrder…(id)).
 */
export async function syncOrderProductionStatus(orderId: string): Promise<void> {
  try {
    if (!isHubConfigured()) return;

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: { id: true, externalRef: true },
    });
    if (!order?.externalRef) return; // not a platform-known order

    const pos = await db.query.purchaseOrders.findMany({
      where: eq(purchaseOrders.orderId, orderId),
      columns: { status: true },
    });
    const status = aggregateProductionStatus(pos.map((p) => p.status));
    if (!status) return;

    await pushProductionStatus(order.externalRef, status);
  } catch (err) {
    logger.error('[hub-sync] production status sync failed', orderId, err);
  }
}
