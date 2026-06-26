/**
 * Domain-event outbox (PROJECT_BRIEF.md §15).
 *
 * Every meaningful state change writes a row to `confirmation.domain_events`
 * inside the SAME transaction as the change. Downstream consumers — the Google
 * Ads conversion, and later the platform's production hand-off — read from here.
 * Writing the event in-transaction guarantees we never confirm an order without
 * also recording the event (no lost events, no phantom events).
 *
 * A separate worker/cron will later deliver `pending` events to subscribers and
 * mark them `delivered`. For now we just durably record them.
 *
 * Admin audit events (token.generated, token.revoked, etc.) use
 * recordAuditEvent() which writes outside a transaction and sets status=delivered
 * immediately — they are purely for the audit log, not for downstream consumers.
 */
import type { Transaction } from '@/db';
import { db } from '@/db';
import { domainEvents } from '@/db/schema';

export type DomainEventType =
  | 'order.viewed'
  | 'order.confirmed'
  | 'order.changes_requested'
  | 'token.generated'
  | 'token.revoked'
  | 'link.emailed'
  | 'order.updated';

export async function emitDomainEvent(
  tx: Transaction,
  params: {
    aggregateId: string;
    eventType: DomainEventType;
    payload: unknown;
    aggregateType?: string;
  },
): Promise<void> {
  await tx.insert(domainEvents).values({
    aggregateType: params.aggregateType ?? 'order',
    aggregateId: params.aggregateId,
    eventType: params.eventType,
    payload: params.payload,
  });
}

/**
 * Record an admin audit event outside any transaction.
 * Status is set to 'delivered' immediately — these events are for the audit
 * log only and have no downstream consumer to deliver to.
 */
export async function recordAuditEvent(params: {
  aggregateId: string;
  eventType: DomainEventType;
  payload: unknown;
  aggregateType?: string;
}): Promise<void> {
  await db.insert(domainEvents).values({
    aggregateType: params.aggregateType ?? 'order',
    aggregateId: params.aggregateId,
    eventType: params.eventType,
    payload: params.payload,
    status: 'delivered',
    deliveredAt: new Date(),
  });
}

/**
 * Fetch the customer comment from the most recent changes-requested event.
 * Returns null if no such event exists.
 */
export async function getChangesRequestedComment(orderId: string): Promise<string | null> {
  const event = await db.query.domainEvents.findFirst({
    where: (e, { and, eq }) => and(
      eq(e.aggregateId, orderId),
      eq(e.eventType, 'order.changes_requested'),
    ),
    orderBy: (e, { desc }) => [desc(e.createdAt)],
  });
  if (!event) return null;
  const payload = event.payload as { comment?: string };
  return payload.comment ?? null;
}

/**
 * Fetch the audit log for a given order, newest first.
 */
export async function getOrderAuditLog(orderId: string) {
  return db.query.domainEvents.findMany({
    where: (e, { and, eq }) => and(
      eq(e.aggregateType, 'order'),
      eq(e.aggregateId, orderId),
    ),
    orderBy: (e, { desc }) => [desc(e.createdAt)],
  });
}
