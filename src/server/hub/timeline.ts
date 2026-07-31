/**
 * Order lifecycle → hub communications timeline (fleet thread
 * 2026-07-31-orders-from-email, mailflow's M3 recommendation, salesflow's
 * visibility ruling).
 *
 * The hub timeline is the customer's cross-fleet history — every sibling app
 * renders whatever lands on it. The contract is the semantic itself: push ONLY
 * what belongs on the customer's timeline. v1 is therefore lifecycle events
 * only — created / confirmed / changes_requested — never internal staff
 * discussion, never supplier-authored notes.
 *
 * Unlike the index snapshot push (order-sync.ts), this is an EVENT push, but
 * it is deliberately best-effort and never throws, including from outbox
 * handlers. Rationale: a strict throw would mark the whole domain event failed
 * and re-run ALL of its handlers on retry — and the confirmation email
 * handlers resend on re-run (documented gap in processor.ts). A duplicated
 * customer email is a worse failure than a missing timeline row. The hub's
 * (channel, externalRef) uniqueness makes any replay that does happen return
 * the existing row rather than duplicate it.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import { orders } from '@/db/schema';
import { logger } from '@/lib/logger';
import { isHubConfigured, postHubCommunication } from './client';

export type OrderTimelineKind = 'created' | 'confirmed' | 'changes_requested';

const SNIPPET_MAX = 500; // the hub stores "first 500 chars" — pre-truncate

/**
 * Pure mapping from lifecycle kind to the timeline item's rendering fields.
 * Direction is who acted: `created` is our act (outbound); `confirmed` and
 * `changes_requested` are the customer's (inbound).
 */
export function buildOrderTimelineItem(
  kind: OrderTimelineKind,
  orderNumber: string | null,
  comment?: string | null,
): { direction: 'inbound' | 'outbound'; subject: string; snippet: string | null } {
  const ref = orderNumber ? `Order ${orderNumber}` : 'Order';
  switch (kind) {
    case 'created':
      return { direction: 'outbound', subject: `${ref} created`, snippet: null };
    case 'confirmed':
      return {
        direction: 'inbound',
        subject: `${ref} confirmed`,
        snippet: 'The customer confirmed the order.',
      };
    case 'changes_requested':
      return {
        direction: 'inbound',
        subject: `${ref}: changes requested`,
        snippet: comment ? comment.slice(0, SNIPPET_MAX) : null,
      };
  }
}

/**
 * Push one lifecycle event for an order onto the hub timeline. No-op when the
 * hub seam is off or the order has no hub customer (nothing to file it under).
 *
 * `externalRef` is the idempotency key with channel='note': callers pass the
 * domain event uuid (outbox paths) or `<orderId>:created` (the create path,
 * which emits no outbox event). Takes an optional executor because outbox
 * handlers run inside the batch transaction and must not touch the global db.
 */
export async function pushOrderTimelineEvent(
  orderId: string,
  kind: OrderTimelineKind,
  opts: {
    externalRef: string;
    occurredAt: Date;
    comment?: string | null;
    executor?: Transaction;
  },
): Promise<void> {
  const ex = opts.executor ?? db;
  try {
    if (!isHubConfigured()) return;

    const [order] = await ex
      .select({
        hubCustomerId: orders.hubCustomerId,
        hubContactId: orders.hubContactId,
        hubOrderId: orders.hubOrderId,
        orderNumber: orders.orderNumber,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order?.hubCustomerId) return;

    const item = buildOrderTimelineItem(kind, order.orderNumber, opts.comment);
    const ok = await postHubCommunication({
      channel: 'note',
      direction: item.direction,
      occurredAt: opts.occurredAt,
      customerId: order.hubCustomerId,
      contactId: order.hubContactId,
      orderId: order.hubOrderId,
      externalRef: opts.externalRef,
      subject: item.subject,
      snippet: item.snippet,
    });
    if (!ok) {
      logger.warn('[hub/timeline] push failed (best-effort, not retried)', { orderId, kind });
    }
  } catch (err) {
    logger.warn('[hub/timeline] push failed (best-effort, not retried)', { orderId, kind, err });
  }
}
