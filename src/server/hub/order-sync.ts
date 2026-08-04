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
import { orders } from '@/db/schema';
import { logger } from '@/lib/logger';
import { isHubConfigured, patchHubOrder, registerHubOrder } from './client';
import { buildOrderIndexRows } from './index-row';

// The chip logic lives with the serializer now (fleet standard §7) — re-export
// so existing importers (and their tests) keep working.
export { orderIndexChip, type OrderIndexChip } from './index-row';

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

    // One serializer for push AND the full-state repair GET (fleet standard
    // §7) — the row here is byte-identical to what read-repair would fetch.
    const [row] = await buildOrderIndexRows([order], opts.executor);

    if (!order.hubOrderId) {
      const hubOrderId = await registerHubOrder({
        customerId: order.hubCustomerId,
        contactId: order.hubContactId ?? null,
        orderNumber: row.orderNumber,
        // The hub row's display label — the order's own name when staff gave
        // it one, else the org/club, else the person.
        name: row.name,
        status: row.status,
        orderValue: row.orderValue,
        currency: row.currency,
        externalId: row.externalId,
        url: row.url,
        pos: row.pos,
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

    const ok = await patchHubOrder(order.hubOrderId, {
      status: row.status,
      orderValue: row.orderValue,
      currency: row.currency,
      url: row.url,
      orderNumber: row.orderNumber,
      pos: row.pos,
      // A PATCH name is an explicit rename hub-side (salesflow, 2026-08-02),
      // so only the order's OWN name goes — never the club/customer fallback,
      // which would clobber a composer-typed name on the index row.
      ...(order.name && { name: order.name }),
    });
    if (!ok && opts.strict) throw new Error('hub order status push failed');
  } catch (err) {
    if (opts.strict) throw err;
    logger.warn('[hub/order-sync] push failed (non-strict)', { orderId, err });
  }
}
