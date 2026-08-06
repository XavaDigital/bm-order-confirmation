/**
 * Conditional reminders: a note attached to ONE order or PO that fires when
 * that job's status becomes a chosen value — e.g. "when this PO reaches
 * production, send the customer a test print for approval."
 *
 * Distinct from `scans.ts`'s `workflowReminders`, which fire on a calendar
 * due-date checked by an hourly scan. These fire event-driven, off the same
 * outbox the rest of the workflow notifications use — see
 * `fireDueStatusReminders`, called from every place `orders.status` /
 * `purchaseOrders.status` is written.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import { workflowStatusReminders } from '@/db/schema';
import type { WorkflowBoardKey } from '@/db/schema';
import { emitOrderEvent, recordAuditEvent } from '@/server/events/outbox';

// Local, rather than imported from `@/server/orders/service`: this module is
// called FROM orders/service.ts and purchase-orders/service.ts (the status
// write sites), so importing their error classes back would be a module
// cycle. `defineRoute` maps errors by NAME SUFFIX (`isNamed`, route-handler.ts),
// not `instanceof`, so a locally-defined class with the right name suffix is
// all a route needs to get the standard 404/409 mapping.
export class ReminderNotFoundError extends Error {
  constructor(entity = 'Reminder') {
    super(`${entity} not found`);
    this.name = 'ReminderNotFoundError';
  }
}

export class ReminderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderConflictError';
  }
}

export interface StatusReminderRow {
  id: string;
  entityType: WorkflowBoardKey;
  entityId: string;
  triggerStatus: string;
  note: string;
  createdByStaffUserId: string;
  firedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

function toRow(row: typeof workflowStatusReminders.$inferSelect): StatusReminderRow {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    triggerStatus: row.triggerStatus,
    note: row.note,
    createdByStaffUserId: row.createdByStaffUserId,
    firedAt: row.firedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Create a conditional reminder on one entity. */
export async function createStatusReminder(
  entityType: WorkflowBoardKey,
  entityId: string,
  triggerStatus: string,
  note: string,
  staffUserId: string,
): Promise<StatusReminderRow> {
  const [row] = await db
    .insert(workflowStatusReminders)
    .values({ entityType, entityId, triggerStatus, note, createdByStaffUserId: staffUserId })
    .returning();

  await recordAuditEvent({
    aggregateId: entityId,
    aggregateType: entityType === 'order' ? 'order' : 'purchase_order',
    eventType: 'workflow.status_reminder_created',
    payload: { reminderId: row.id, triggerStatus, note },
    actorEmail: null,
  });

  return toRow(row);
}

/**
 * Cancel a pending reminder before it fires. Creator or admin — mirrors
 * `reopenTask`'s admin-for-others convention, but a person may always cancel
 * their own.
 */
export async function cancelStatusReminder(
  id: string,
  actor: { staffUserId: string; isAdmin: boolean },
): Promise<void> {
  const [existing] = await db
    .select()
    .from(workflowStatusReminders)
    .where(eq(workflowStatusReminders.id, id));
  if (!existing) throw new ReminderNotFoundError();
  if (existing.resolvedAt) return; // already fired or cancelled — no-op

  if (existing.createdByStaffUserId !== actor.staffUserId && !actor.isAdmin) {
    throw new ReminderConflictError(
      'Only the person who set this reminder, or an admin, can cancel it',
    );
  }

  await db
    .update(workflowStatusReminders)
    .set({ resolvedAt: new Date() })
    .where(and(eq(workflowStatusReminders.id, id), isNull(workflowStatusReminders.resolvedAt)));

  await recordAuditEvent({
    aggregateId: existing.entityId,
    aggregateType: existing.entityType === 'order' ? 'order' : 'purchase_order',
    eventType: 'workflow.status_reminder_cancelled',
    payload: { reminderId: id, triggerStatus: existing.triggerStatus },
    actorEmail: null,
  });
}

/** Pending and recently-fired reminders for one entity, newest first. */
export async function listStatusReminders(
  entityType: WorkflowBoardKey,
  entityId: string,
): Promise<StatusReminderRow[]> {
  const rows = await db
    .select()
    .from(workflowStatusReminders)
    .where(
      and(
        eq(workflowStatusReminders.entityType, entityType),
        eq(workflowStatusReminders.entityId, entityId),
      ),
    )
    .orderBy(desc(workflowStatusReminders.createdAt));
  return rows.map(toRow);
}

/**
 * Fire every live reminder on this entity whose trigger status matches the
 * status it just moved to. Called from inside the SAME transaction as the
 * status write, with that transaction's `tx` — never the global `db`, which
 * would deadlock PGlite's single connection if called from inside one.
 *
 * One-shot, exact-match: a job whose status jumps past `newStatus` without
 * ever equaling it leaves the reminder pending (visible in the UI) until
 * someone cancels it — there is no retroactive catch-up scan. The
 * `resolvedAt is null` guard on the update makes a retried/duplicate call a
 * no-op, so this is safe to call unconditionally on every status write.
 */
export async function fireDueStatusReminders(
  tx: Transaction,
  entityType: WorkflowBoardKey,
  entityId: string,
  newStatus: string,
  orderId: string,
): Promise<void> {
  const due = await tx
    .select()
    .from(workflowStatusReminders)
    .where(
      and(
        eq(workflowStatusReminders.entityType, entityType),
        eq(workflowStatusReminders.entityId, entityId),
        eq(workflowStatusReminders.triggerStatus, newStatus),
        isNull(workflowStatusReminders.resolvedAt),
      ),
    );
  if (due.length === 0) return;

  const now = new Date();
  for (const reminder of due) {
    const updated = await tx
      .update(workflowStatusReminders)
      .set({ firedAt: now, resolvedAt: now })
      .where(
        and(
          eq(workflowStatusReminders.id, reminder.id),
          isNull(workflowStatusReminders.resolvedAt),
        ),
      )
      .returning({ id: workflowStatusReminders.id });
    if (updated.length === 0) continue; // already fired by a concurrent caller

    await emitOrderEvent(tx, {
      aggregateId: orderId,
      eventType: 'workflow.status_reminder_due',
      payload: {
        reminderId: reminder.id,
        entityType,
        entityId,
        triggerStatus: newStatus,
        note: reminder.note,
        staffUserId: reminder.createdByStaffUserId,
      },
    });
  }
}
