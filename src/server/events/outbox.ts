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
  // "Got Your Back" name list (GOT_YOUR_BACK_PLAN.md), audit-only — same
  // cluster as sizing.updated: staff/manager action history, not a state
  // change a downstream outbox consumer needs to react to.
  | 'name_list.updated'
  | 'name_list.imported_from_roster'
  | 'mockup.added'
  | 'mockup.removed'
  | 'mockup.caption_updated'
  | 'chart_links.updated'
  | 'roster.member_updated'
  | 'asset.added'
  | 'asset.updated'
  | 'asset.removed'
  | 'order.reprint_created'
  | 'order.color_sample_requested'
  | 'order.color_sample_resolved'
  | 'order.changes_requested'
  | 'order.cancelled'
  | 'token.generated'
  | 'token.revoked'
  | 'link.emailed'
  | 'order.updated'
  | 'order.duplicated'
  // Notes: `order.note_added` is an outbox event (notification dispatch hangs
  // off it). Edits and deletes are audit-only — they are staff action history,
  // not something a consumer acts on.
  | 'order.note_added'
  // Edit/delete follow-ups so the hub's upsert-by-id cache converges
  // (FLEET_STANDARD_ANNOTATIONS R1); no notification hangs off either.
  | 'order.note_updated'
  | 'order.note_deleted'
  | 'note.edited'
  | 'note.deleted'
  // Audit-only: a status set through the generic admin PATCH. Distinct from the
  // customer-driven order.confirmed / order.changes_requested outbox events.
  | 'order.status_changed'
  // Workflow stage moves (audit-only; the board is a staff view, not a
  // consumer-facing state machine).
  | 'workflow.stage_entered'
  | 'workflow.stage_exited'
  | 'workflow.task_confirmed'
  | 'workflow.task_reopened'
  | 'workflow.owners_changed'
  | 'workflow.gate_overridden'
  // Conditional (status-triggered) reminders on one order/PO. `_due` is an
  // outbox event (notification dispatch hangs off it, see processor.ts);
  // created/cancelled are audit-only, like the stage-configuration events.
  | 'workflow.status_reminder_created'
  | 'workflow.status_reminder_cancelled'
  | 'workflow.status_reminder_due'
  // Acknowledgement settings (audit-only): staff editing the customer-facing
  // confirmation checkboxes.
  | 'ack_setting.created'
  | 'ack_setting.updated'
  // Stage configuration (audit-only). Who changed the shape of the board is
  // staff action history; no consumer acts on it.
  | 'workflow.stage_created'
  | 'workflow.stage_updated'
  | 'workflow.stages_reordered'
  | 'access_code.enabled'
  | 'access_code.disabled'
  | 'roster.member_added'
  | 'roster.member_removed'
  | 'roster.token_generated'
  | 'roster.token_revoked'
  | 'roster.locked'
  | 'roster.unlocked'
  | 'roster.page_updated'
  | 'roster.import_completed'
  | 'roster.link_emailed'
  | 'roster.page_emailed'
  | 'roster.reminder_sent'
  | 'roster.member_link_generated'
  | 'roster.member_link_emailed'
  | 'staff.password_reset_requested'
  | 'staff.password_reset_completed'
  // Purchase orders + shipments (PO_PLAN). 'po.sent' and the shipment.* types
  // are emitted by later phases — declared now so the union is complete.
  | 'po.created'
  | 'po.updated'
  | 'po.sent'
  | 'po.revised'
  | 'po.status_changed'
  | 'po.cancelled'
  | 'shipment.created'
  | 'shipment.updated'
  | 'shipment.status_changed'
  // Supplier portal (SUPPLIER_PORTAL_PLAN.md). Distinct from po.status_changed
  // so notification routing can tell "a supplier did this" from "staff did this".
  | 'po.supplier_updated'
  // Audit-only (David, 2026-08-05): who moved the expected ship date, and
  // from what to what. Recorded by both the staff PATCH and the supplier
  // portal; no notification hangs off it.
  | 'po.ship_date_changed'
  // Production files (David, 2026-08-05): a supplier or staff member uploaded
  // a working file (layout, test print…). Outbox so notifications can hang
  // off supplier uploads later; file_removed is audit-only.
  | 'po.file_uploaded'
  | 'po.file_removed'
  // Audit-only: a pre-send checklist tick/untick, with who and which item.
  | 'po.check_changed'
  // Awaiting-approval flag (David, 2026-08-06): the supplier submits a
  // finished phase and the PO badges until we approve. Outbox on both
  // sides — notifications and automations hang off them.
  | 'po.submitted_for_approval'
  | 'po.approval_given'
  // Audit-only: the CHECKS themselves being configured (added, renamed,
  // retired, made sidesteppable). Staff action history on config, not a tick.
  | 'po.check_item_created'
  | 'po.check_item_updated'
  // Configurable automations (David, 2026-08-06). Audit-only: `automation.fired`
  // names the rule and what it did, so an automatic status move is never
  // anonymous; the *.rule_* types are config history.
  | 'automation.fired'
  | 'automation.rule_created'
  | 'automation.rule_updated'
  | 'supplier_link.generated'
  | 'supplier_link.revoked';

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
 * lifecycle and carry actor attribution as a real column (`actorEmail` param —
 * do not put the actor in the payload). Pass `tx` when the mutation runs in a
 * transaction so the audit entry can't be lost between the write and the record.
 */
export async function recordAuditEvent(
  params: {
    aggregateId: string;
    eventType: DomainEventType;
    payload: Record<string, unknown>;
    aggregateType?:
      | 'order'
      | 'staff_user'
      | 'garment_type'
      | 'purchase_order'
      | 'supplier'
      | 'shipment'
      // The column is plain text, so widening this union is a type-only change.
      | 'workflow_stage'
      | 'acknowledgement_setting'
      | 'po_checklist_item'
      | 'automation_rule';
    actorEmail?: string | null;
  },
  tx?: Transaction,
): Promise<void> {
  await (tx ?? db).insert(auditEvents).values({
    aggregateType: params.aggregateType ?? 'order',
    aggregateId: params.aggregateId,
    eventType: params.eventType,
    actorEmail: params.actorEmail ?? null,
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
 * Merges two sources: `audit_events` (staff/customer action history) and
 * `domain_events` (outbox rows — which ARE part of the order's history).
 * Actor attribution: audit rows carry it as a real column; outbox rows carry
 * it in the payload (the outbox schema has no actor column by design).
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
      actorEmail:
        typeof e.payload?.actorEmail === 'string' ? (e.payload.actorEmail as string) : null,
      createdAt: e.createdAt,
    })),
    ...auditRows.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      payload: e.payload,
      actorEmail: e.actorEmail,
      createdAt: e.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
