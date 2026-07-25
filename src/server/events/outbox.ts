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
import { count, and, eq } from 'drizzle-orm';
import type { Transaction } from '@/db';
import { db } from '@/db';
import { domainEvents, auditEvents } from '@/db/schema';

export type DomainEventType =
  | 'order.viewed'
  | 'order.confirmed'
  | 'order.deleted'
  | 'garment.added'
  | 'garment.updated'
  | 'garment.removed'
  | 'sizing.updated'
  | 'mockup.added'
  | 'mockup.removed'
  | 'chart_links.updated'
  | 'roster.member_updated'
  | 'order.color_sample_requested'
  | 'order.color_sample_resolved'
  | 'order.changes_requested'
  | 'order.cancelled'
  | 'token.generated'
  | 'token.revoked'
  | 'link.emailed'
  | 'order.updated'
  | 'order.duplicated'
  | 'order.note_added'
  | 'access_code.enabled'
  | 'access_code.disabled'
  | 'roster.member_added'
  | 'roster.member_removed'
  | 'roster.token_generated'
  | 'roster.token_revoked'
  | 'roster.locked'
  | 'roster.unlocked'
  | 'roster.import_completed'
  | 'roster.link_emailed'
  | 'roster.reminder_sent'
  | 'roster.member_link_generated'
  | 'roster.member_link_emailed'
  | 'staff.password_reset_requested'
  | 'staff.password_reset_completed';

export async function emitDomainEvent(
  tx: Transaction,
  params: {
    aggregateId: string;
    eventType: DomainEventType;
    payload: Record<string, unknown>;
    aggregateType?: 'order';
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
 * Build an emitter bound to one aggregate type, so call sites can't fat-finger
 * (or forget) the aggregateType on every emit.
 */
export function makeEmitter(aggregateType: 'order') {
  return async (
    tx: Transaction,
    params: {
      aggregateId: string;
      eventType: DomainEventType;
      payload: Record<string, unknown>;
    },
  ): Promise<void> => {
    await tx.insert(domainEvents).values({
      aggregateType,
      aggregateId: params.aggregateId,
      eventType: params.eventType,
      payload: params.payload,
    });
  };
}

/** Outbox emitter for the `order` aggregate — the standard emitter for this app. */
export const emitOrderEvent = makeEmitter('order');

/**
 * Record an audit event (staff/customer action history).
 *
 * Writes to `audit_events` — NOT the outbox. Audit rows have no delivery
 * lifecycle and carry actor attribution as a real column. Pass `tx` when the
 * mutation runs in a transaction so the audit entry can't be lost between the
 * write and the record. Actor is lifted from params.actorEmail, falling back
 * to payload.actorEmail (the legacy call convention).
 */
export async function recordAuditEvent(
  params: {
    aggregateId: string;
    eventType: DomainEventType;
    payload: Record<string, unknown>;
    aggregateType?: 'order' | 'staff_user' | 'garment_type' | 'purchase_order' | 'supplier' | 'shipment';
    actorEmail?: string | null;
  },
  tx?: Transaction,
): Promise<void> {
  await (tx ?? db).insert(auditEvents).values({
    aggregateType: params.aggregateType ?? 'order',
    aggregateId: params.aggregateId,
    eventType: params.eventType,
    actorEmail:
      params.actorEmail ??
      (typeof params.payload.actorEmail === 'string' ? params.payload.actorEmail : null),
    payload: params.payload,
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
 * Count how many times changes have been requested on this order.
 * Used to display "Round N" in the admin detail view when there's more than one round.
 */
export async function getChangesRequestedCount(orderId: string): Promise<number> {
  const result = await db
    .select({ n: count() })
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.aggregateId, orderId),
        eq(domainEvents.eventType, 'order.changes_requested'),
      ),
    );
  return result[0]?.n ?? 0;
}

/**
 * Fetch the audit log for a given order, newest first.
 *
 * Merges two sources: `audit_events` (all audit rows since the 2026-07-26
 * split) and `domain_events` (outbox rows — which ARE part of the order's
 * history — plus legacy audit rows written before the split).
 */
export async function getOrderAuditLog(orderId: string) {
  const [outboxRows, auditRows] = await Promise.all([
    db.query.domainEvents.findMany({
      where: (e, { and, eq }) => and(
        eq(e.aggregateType, 'order'),
        eq(e.aggregateId, orderId),
      ),
    }),
    db.query.auditEvents.findMany({
      where: (e, { and, eq }) => and(
        eq(e.aggregateType, 'order'),
        eq(e.aggregateId, orderId),
      ),
    }),
  ]);

  return [
    ...outboxRows.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt,
    })),
    ...auditRows.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
