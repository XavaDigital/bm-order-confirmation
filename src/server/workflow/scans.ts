/**
 * Time-driven scans: work that has sat too long, and reminders that have come
 * due.
 *
 * Runs from the in-process scheduler (`src/server/scheduler/runtime.ts`). Every
 * scan must be safe to run twice — a tick can be missed, retried, or run
 * concurrently in a second container — which is why every send goes through the
 * notification claim ledger. See `runWorkflowScans` for why that, rather than a
 * lock, is what makes it safe.
 */
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import { orders, purchaseOrders, workflowReminders } from '@/db/schema';
import type { WorkflowBoardKey } from '@/db/schema';
import { logger } from '@/lib/logger';
import { dispatchNotification } from '@/server/notifications/dispatch';
import { findStuckEntities } from './board';

export interface ScanResult {
  ran: boolean;
  stuck: number;
  remindersFired: number;
  notified: number;
}

/**
 * Day-resolution dedupe key.
 *
 * Bucketing by day is what stops an hourly scan emailing about the same stuck
 * job every hour: the claim ledger sees the same key all day and lets exactly
 * one through. Tomorrow's bucket is a new key, so a job that is still stuck says
 * so again — once.
 */
export function stuckDedupeKey(entityId: string, stageSlug: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `stuck:${entityId}:${stageSlug}:${day}`;
}

/**
 * Users who have snoozed this entity past `now`.
 *
 * Per-user, so a snooze quiets the person who set it and nobody else.
 */
async function snoozedUserIds(
  entityType: WorkflowBoardKey,
  entityId: string,
  now: Date,
  executor: Transaction | typeof db = db,
): Promise<string[]> {
  const rows = await executor
    .select({ staffUserId: workflowReminders.staffUserId })
    .from(workflowReminders)
    .where(
      and(
        eq(workflowReminders.entityType, entityType),
        eq(workflowReminders.entityId, entityId),
        eq(workflowReminders.kind, 'snooze'),
        isNull(workflowReminders.resolvedAt),
        gt(workflowReminders.dueAt, now),
      ),
    );
  return rows.map((row) => row.staffUserId);
}

/** Notify stage owners about work that has sat past its warn threshold. */
async function scanStuck(now: Date): Promise<{ stuck: number; notified: number }> {
  let stuck = 0;
  let notified = 0;

  for (const boardKey of ['order', 'purchase_order'] as const) {
    const entities = await findStuckEntities(boardKey, now);
    stuck += entities.length;

    for (const entity of entities) {
      const excludeStaffUserIds = await snoozedUserIds(boardKey, entity.entityId, now);
      const orderId =
        boardKey === 'order' ? entity.entityId : await orderIdForPo(entity.entityId);

      const result = await dispatchNotification('workflow.stuck', {
        dedupeKey: stuckDedupeKey(entity.entityId, entity.stageSlug, now),
        entityType: boardKey,
        entityId: entity.entityId,
        stageSlug: entity.stageSlug,
        boardKey,
        excludeStaffUserIds,
        title: `${entity.reference} has been in ${entity.stageSlug} for ${Math.floor(
          entity.hoursInStage / 24,
        )} days`,
        body:
          entity.urgency === 'urgent'
            ? 'This is well past its expected time in this stage.'
            : 'This is past its expected time in this stage.',
        href: orderId ? `/admin/orders/${orderId}?tab=checklist` : null,
      });
      notified += result.notified.length;
    }
  }

  return { stuck, notified };
}

async function orderIdForPo(poId: string): Promise<string | null> {
  const [po] = await db
    .select({ orderId: purchaseOrders.orderId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId));
  return po?.orderId ?? null;
}

/**
 * Fire reminders whose time has come, and resolve them.
 *
 * A reminder is resolved as it fires so it cannot fire twice, and the person who
 * set it is the only recipient — a reminder is a note to yourself.
 */
async function scanReminders(now: Date): Promise<{ fired: number; notified: number }> {
  const due = await db
    .select()
    .from(workflowReminders)
    .where(
      and(
        eq(workflowReminders.kind, 'reminder'),
        isNull(workflowReminders.resolvedAt),
        lte(workflowReminders.dueAt, now),
      ),
    );

  let notified = 0;
  for (const reminder of due) {
    const reference = await entityReference(reminder.entityType, reminder.entityId);
    const orderId =
      reminder.entityType === 'order'
        ? reminder.entityId
        : await orderIdForPo(reminder.entityId);

    const result = await dispatchNotification('workflow.reminder', {
      dedupeKey: `reminder:${reminder.id}`,
      entityType: reminder.entityType,
      entityId: reminder.entityId,
      // A reminder goes to whoever set it, whatever the configured rules say.
      title: `Reminder: ${reference ?? 'a job'}`,
      body: reminder.note,
      href: orderId ? `/admin/orders/${orderId}` : null,
      forceRecipientIds: [reminder.staffUserId],
    });
    notified += result.notified.length;

    await db
      .update(workflowReminders)
      .set({ resolvedAt: now })
      .where(eq(workflowReminders.id, reminder.id));
  }

  return { fired: due.length, notified };
}

async function entityReference(
  entityType: WorkflowBoardKey,
  entityId: string,
): Promise<string | null> {
  if (entityType === 'order') {
    const [row] = await db
      .select({ reference: orders.orderNumber })
      .from(orders)
      .where(eq(orders.id, entityId));
    return row?.reference ?? null;
  }
  const [row] = await db
    .select({ reference: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, entityId));
  return row?.reference ?? null;
}

/**
 * One tick of the time-driven work.
 *
 * Deliberately NOT wrapped in a transaction, and deliberately NOT guarded by an
 * advisory lock.
 *
 * The plan called for `pg_try_advisory_xact_lock`, but a transaction-scoped lock
 * would mean holding a transaction open for the whole scan — including the
 * notification sends — which is exactly what the notification design says not to
 * do, and which deadlocks PGlite's single connection in tests.
 *
 * It turns out the lock was never load-bearing for correctness: every send is
 * claimed in `notification_deliveries` first, and that claim is atomic. Two
 * containers scanning at the same moment therefore duplicate a little read work
 * and notify nobody twice. Wasted effort is an acceptable price for not holding
 * a long transaction; double-notifying would not be.
 *
 * `ran` stays in the result shape for callers and for a future lease-based
 * guard, and is always true today.
 */
export async function runWorkflowScans(now = new Date()): Promise<ScanResult> {
  const stuckResult = await scanStuck(now);
  const reminderResult = await scanReminders(now);

  const result = {
    ran: true,
    stuck: stuckResult.stuck,
    remindersFired: reminderResult.fired,
    notified: stuckResult.notified + reminderResult.notified,
  };

  if (result.stuck > 0 || result.remindersFired > 0) {
    logger.info('[scans] workflow scan complete', result);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Snooze / reminder management
// ---------------------------------------------------------------------------

export const SNOOZE_PRESETS = [
  { key: '1d', label: 'Tomorrow', hours: 24 },
  { key: '2d', label: 'In 2 days', hours: 48 },
  { key: '1w', label: 'Next week', hours: 24 * 7 },
] as const;

/**
 * Snooze or set a reminder. Re-snoozing EXTENDS the existing row rather than
 * adding another, which is what the partial unique index enforces.
 */
export async function upsertReminder(
  entityType: WorkflowBoardKey,
  entityId: string,
  staffUserId: string,
  kind: 'snooze' | 'reminder',
  dueAt: Date,
  note?: string | null,
): Promise<void> {
  await db
    .insert(workflowReminders)
    .values({ entityType, entityId, staffUserId, kind, dueAt, note: note ?? null })
    .onConflictDoUpdate({
      target: [
        workflowReminders.entityType,
        workflowReminders.entityId,
        workflowReminders.staffUserId,
        workflowReminders.kind,
      ],
      targetWhere: isNull(workflowReminders.resolvedAt),
      set: { dueAt, note: note ?? null },
    });
}

/** Clear a live snooze or reminder for one person. */
export async function clearReminder(
  entityType: WorkflowBoardKey,
  entityId: string,
  staffUserId: string,
  kind: 'snooze' | 'reminder',
): Promise<void> {
  await db
    .update(workflowReminders)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(workflowReminders.entityType, entityType),
        eq(workflowReminders.entityId, entityId),
        eq(workflowReminders.staffUserId, staffUserId),
        eq(workflowReminders.kind, kind),
        isNull(workflowReminders.resolvedAt),
      ),
    );
}

/** Live reminders and snoozes for one person, soonest first. */
export async function listRemindersForUser(staffUserId: string) {
  return db
    .select()
    .from(workflowReminders)
    .where(
      and(eq(workflowReminders.staffUserId, staffUserId), isNull(workflowReminders.resolvedAt)),
    )
    .orderBy(workflowReminders.dueAt);
}
