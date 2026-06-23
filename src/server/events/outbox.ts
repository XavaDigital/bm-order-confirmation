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
 */
import type { Transaction } from '@/db';
import { domainEvents } from '@/db/schema';

export type DomainEventType =
  | 'order.viewed'
  | 'order.confirmed'
  | 'order.changes_requested';

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
