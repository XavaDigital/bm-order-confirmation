/**
 * Resolving who gets told, and telling them exactly once.
 *
 * Called from OUTBOX HANDLERS, never inline in a service and never inside a
 * transaction: sending is slow and can fail, and neither should be able to roll
 * back the business change that caused it.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import type { Transaction } from '@/db';
import {
  assignments,
  inboxItems,
  notificationDeliveries,
  notificationEventSettings,
  notificationRecipientRules,
  orders,
  purchaseOrders,
  staffUsers,
  workflowStages,
} from '@/db/schema';
import { logger } from '@/lib/logger';
import { findNotification, type RecipientRule } from './catalog';

export interface DispatchContext {
  /** Domain-events row id — the natural dedupe key for an event-driven send. */
  dedupeKey: string;
  entityType?: 'order' | 'purchase_order';
  entityId?: string;
  /** Set for stage-scoped events, so `stage_owners` can resolve. */
  stageSlug?: string;
  boardKey?: 'order' | 'purchase_order';
  /** Never notify the person who caused the event. */
  actorStaffUserId?: string | null;
  actorEmail?: string | null;
  /** Already told by another handler — used to avoid double-telling. */
  excludeStaffUserIds?: string[];
  /**
   * Bypass rule resolution entirely and notify exactly these people.
   *
   * For notifications whose recipient is a property of the thing itself rather
   * than a policy — a reminder goes to whoever set it, and no admin config
   * should be able to redirect that somewhere else.
   */
  forceRecipientIds?: string[];
  title: string;
  body?: string | null;
  href?: string | null;
}

/**
 * Anything that can run a query: the pool, or an open transaction.
 *
 * Dispatch is called from outbox handlers, which run INSIDE the processor's
 * batch transaction. Reaching for the global `db` from there deadlocks PGlite's
 * single connection, so every query below goes through the executor the caller
 * supplies.
 */
type Executor = Transaction | typeof db;

export interface Recipient {
  staffUserId: string;
  email: string;
  name: string;
}

/** Effective settings: the DB row if one exists, else the code default. */
async function resolveSettings(key: string, executor: Executor) {
  const definition = findNotification(key);
  if (!definition) return null;

  const [override] = await executor
    .select()
    .from(notificationEventSettings)
    .where(eq(notificationEventSettings.eventKey, key));

  return {
    definition,
    enabled: override?.enabled ?? definition.defaultEnabled,
    emailEnabled: override?.emailEnabled ?? definition.defaultEmailEnabled,
  };
}

/** Effective rules: any configured for this key, else the code defaults. */
async function resolveRules(
  key: string,
  fallback: RecipientRule[],
  executor: Executor,
): Promise<RecipientRule[]> {
  const rows = await executor
    .select()
    .from(notificationRecipientRules)
    .where(eq(notificationRecipientRules.eventKey, key));

  if (rows.length === 0) return fallback;
  return rows.map((row) => ({
    kind: row.kind,
    roleKey: row.roleKey ?? undefined,
    staffUserIds: row.staffUserIds,
  }));
}

async function activeUsers(ids: string[], executor: Executor): Promise<Recipient[]> {
  if (ids.length === 0) return [];
  const rows = await executor
    .select({ staffUserId: staffUsers.id, email: staffUsers.email, name: staffUsers.name })
    .from(staffUsers)
    .where(and(inArray(staffUsers.id, [...new Set(ids)]), eq(staffUsers.isActive, true)));
  return rows;
}

/**
 * Turn the rules into a concrete set of people.
 *
 * Deactivated users are dropped at the last step rather than per-rule, so a rule
 * that names someone who has left simply contributes nobody instead of erroring.
 */
export async function resolveRecipients(
  rules: RecipientRule[],
  context: DispatchContext,
  executor: Executor = db,
): Promise<Recipient[]> {
  const ids = new Set<string>();

  for (const rule of rules) {
    switch (rule.kind) {
      case 'specific_users':
        for (const id of rule.staffUserIds ?? []) ids.add(id);
        break;

      case 'role': {
        if (!rule.roleKey) break;
        const rows = await executor
          .select({ id: staffUsers.id })
          .from(staffUsers)
          .where(
            and(
              eq(staffUsers.role, rule.roleKey as 'sales' | 'admin'),
              eq(staffUsers.isActive, true),
            ),
          );
        for (const row of rows) ids.add(row.id);
        break;
      }

      case 'stage_owners': {
        if (!context.stageSlug || !context.boardKey) break;
        const [stage] = await executor
          .select({ id: workflowStages.id })
          .from(workflowStages)
          .where(
            and(
              eq(workflowStages.boardKey, context.boardKey),
              eq(workflowStages.slug, context.stageSlug),
            ),
          );
        if (!stage) break;
        const owners = await executor
          .select({ id: assignments.staffUserId })
          .from(assignments)
          .where(
            and(
              eq(assignments.entityType, 'workflow_stage'),
              eq(assignments.entityId, stage.id),
            ),
          );
        for (const owner of owners) ids.add(owner.id);
        break;
      }

      case 'entity_assignees': {
        if (!context.entityType || !context.entityId) break;
        const rows = await executor
          .select({ id: assignments.staffUserId })
          .from(assignments)
          .where(
            and(
              eq(assignments.entityType, context.entityType),
              eq(assignments.entityId, context.entityId),
            ),
          );
        for (const row of rows) ids.add(row.id);
        break;
      }

      case 'order_owner': {
        if (!context.entityId) break;
        const orderId =
          context.entityType === 'purchase_order'
            ? (
                await executor
                  .select({ orderId: purchaseOrders.orderId })
                  .from(purchaseOrders)
                  .where(eq(purchaseOrders.id, context.entityId))
              )[0]?.orderId
            : context.entityId;
        if (!orderId) break;
        const [order] = await executor
          .select({ createdBy: orders.createdBy })
          .from(orders)
          .where(eq(orders.id, orderId));
        if (order?.createdBy) ids.add(order.createdBy);
        break;
      }

      case 'po_creator': {
        if (context.entityType !== 'purchase_order' || !context.entityId) break;
        const [po] = await executor
          .select({ createdBy: purchaseOrders.createdBy })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, context.entityId));
        if (po?.createdBy) ids.add(po.createdBy);
        break;
      }

      case 'intrinsic':
        // Reserved for events whose recipient is implied by the event itself
        // (e.g. "your invite"). Nothing uses it yet; listed so an admin cannot
        // configure a rule kind the resolver would silently ignore.
        break;
    }
  }

  // The person who did the thing does not need telling they did it.
  if (context.actorStaffUserId) ids.delete(context.actorStaffUserId);
  for (const excluded of context.excludeStaffUserIds ?? []) ids.delete(excluded);

  return activeUsers([...ids], executor);
}

/**
 * Claim a send for one person on one channel.
 *
 * The unique index does the work: the insert either succeeds (we own this send)
 * or conflicts (someone already has it). Returns false when the claim was
 * already taken, which is how a retried outbox event avoids re-sending.
 */
async function claim(
  eventKey: string,
  dedupeKey: string,
  staffUserId: string,
  channel: 'email' | 'inbox',
  executor: Executor,
): Promise<boolean> {
  const inserted = await executor
    .insert(notificationDeliveries)
    .values({ eventKey, dedupeKey, staffUserId, channel })
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });

  return inserted.length > 0;
}

export interface DispatchResult {
  notified: string[];
  skipped: 'disabled' | 'unknown-key' | 'no-recipients' | null;
}

/**
 * Notify everyone a rule set resolves to, exactly once per event.
 *
 * The inbox row is written first and carries the email on it; a separate pass
 * sends and clears it. That ordering means a crash between the two leaves a
 * visible in-app item and a retryable email, rather than an email with nothing
 * in the app to match it.
 */
export async function dispatchNotification(
  key: string,
  context: DispatchContext,
  executor: Executor = db,
): Promise<DispatchResult> {
  const settings = await resolveSettings(key, executor);
  if (!settings) {
    logger.warn(`[notifications] no catalog entry for "${key}"`);
    return { notified: [], skipped: 'unknown-key' };
  }
  if (!settings.enabled) return { notified: [], skipped: 'disabled' };

  const recipients = context.forceRecipientIds
    ? await activeUsers(context.forceRecipientIds, executor)
    : await resolveRecipients(
        await resolveRules(key, settings.definition.defaultRules, executor),
        context,
        executor,
      );
  if (recipients.length === 0) return { notified: [], skipped: 'no-recipients' };

  const notified: string[] = [];
  for (const recipient of recipients) {
    if (!(await claim(key, context.dedupeKey, recipient.staffUserId, 'inbox', executor)))
      continue;

    await executor.insert(inboxItems).values({
      staffUserId: recipient.staffUserId,
      eventKey: key,
      title: context.title,
      body: context.body ?? null,
      href: context.href ?? null,
      entityType: context.entityType ?? null,
      entityId: context.entityId ?? null,
      // Only stage the email when email is on for this event; otherwise the row
      // is in-app only and the sender pass will never pick it up.
      emailSubject: settings.emailEnabled ? context.title : null,
      emailHtml: settings.emailEnabled ? renderEmailHtml(context) : null,
    });

    await executor
      .update(notificationDeliveries)
      .set({ sentAt: new Date() })
      .where(
        and(
          eq(notificationDeliveries.eventKey, key),
          eq(notificationDeliveries.dedupeKey, context.dedupeKey),
          eq(notificationDeliveries.staffUserId, recipient.staffUserId),
          eq(notificationDeliveries.channel, 'inbox'),
        ),
      );

    notified.push(recipient.staffUserId);
  }

  return { notified, skipped: null };
}

/** Minimal HTML body — the app's email templates live in src/lib/email.ts. */
function renderEmailHtml(context: DispatchContext): string {
  const link = context.href
    ? `<p><a href="${context.href}">Open in the order portal</a></p>`
    : '';
  return `<p>${escapeHtml(context.title)}</p>${
    context.body ? `<p>${escapeHtml(context.body)}</p>` : ''
  }${link}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Unread count for the bell badge. */
export async function getUnreadCount(staffUserId: string): Promise<number> {
  const rows = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.staffUserId, staffUserId), isNull(inboxItems.readAt)));
  return rows.length;
}

export interface InboxItemDto {
  id: string;
  eventKey: string;
  title: string;
  body: string | null;
  href: string | null;
  entityType: 'order' | 'purchase_order' | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listInbox(
  staffUserId: string,
  opts?: { limit?: number; unreadOnly?: boolean },
): Promise<InboxItemDto[]> {
  const rows = await db.query.inboxItems.findMany({
    where: opts?.unreadOnly
      ? and(eq(inboxItems.staffUserId, staffUserId), isNull(inboxItems.readAt))
      : eq(inboxItems.staffUserId, staffUserId),
    orderBy: (item, { desc }) => [desc(item.createdAt)],
    limit: opts?.limit ?? 30,
  });

  return rows.map((row) => ({
    id: row.id,
    eventKey: row.eventKey,
    title: row.title,
    body: row.body,
    href: row.href,
    entityType: row.entityType,
    entityId: row.entityId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Mark items read. Scoped to the caller so one user cannot clear another's. */
export async function markInboxRead(
  staffUserId: string,
  itemIds?: string[],
): Promise<number> {
  const rows = await db
    .update(inboxItems)
    .set({ readAt: new Date() })
    .where(
      itemIds && itemIds.length > 0
        ? and(
            eq(inboxItems.staffUserId, staffUserId),
            inArray(inboxItems.id, itemIds),
            isNull(inboxItems.readAt),
          )
        : and(eq(inboxItems.staffUserId, staffUserId), isNull(inboxItems.readAt)),
    )
    .returning({ id: inboxItems.id });

  return rows.length;
}
