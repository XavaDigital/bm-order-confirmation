/**
 * Outbox processor — picks up pending (and due-for-retry failed) domain_events
 * rows and delivers them to their registered handlers (Google Ads conversion,
 * staff email, future webhook).
 *
 * Call processOutbox() from a cron endpoint (POST /api/internal/process-outbox).
 * Each event is marked 'delivered' when all handlers succeed. On failure,
 * `attempts` increments and the event is re-armed as 'failed' with an
 * exponential-backoff `nextAttemptAt`, until MAX_ATTEMPTS is reached, at which
 * point it's marked 'dead' (see redriveEvent() for the admin "Retry now" path).
 * The WHERE status=<status the row had when selected> guard on every UPDATE
 * acts as an optimistic lock: concurrent runs that grab the same event will
 * simply no-op on the second update.
 *
 * IMPORTANT for handler authors: a retried event re-runs ALL of that event's
 * handlers, not just the one(s) that failed — there's no per-handler status.
 * Every handler must therefore be safe to call again after a partial success
 * (e.g. Google Ads already skips when conversion_events.status='sent'; email
 * handlers currently have no such guard, so a retry after a partial failure
 * can resend an email that already went out).
 */
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { db, type Transaction } from '@/db';
import { domainEvents, orderNotes, workflowStages } from '@/db/schema';
import { fireGoogleAdsConversion } from '@/server/conversions/google-ads';
import {
  notifyStaffOfConfirmation,
  notifyStaffOfChangeRequest,
  notifyStaffOfColorSampleRequest,
  notifyCustomerOfConfirmation,
} from '@/server/orders/notifications';
import { dispatchNotification } from '@/server/notifications/dispatch';
import { logger } from '@/lib/logger';

const BATCH_SIZE = 20;

// Exponential backoff schedule, indexed by attempt number (1st failure → 1m, ...,
// 5th failure → 12h). Once attempts reaches BACKOFF_MINUTES.length the event is
// dead-lettered instead of scheduled again.
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

type DomainEvent = typeof domainEvents.$inferSelect;
/**
 * Handlers run INSIDE the batch transaction (see processOutbox), so any handler
 * that touches the database must use the `tx` it is given. Reaching for the
 * global `db` from here deadlocks PGlite's single connection and hangs the
 * suite; against real Postgres it silently escapes the batch's atomicity.
 */
type EventHandler = (event: DomainEvent, tx: Transaction) => Promise<void>;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGoogleAdsConversion(event: DomainEvent): Promise<void> {
  await fireGoogleAdsConversion(event.aggregateId);
}

async function handleConfirmationEmail(event: DomainEvent): Promise<void> {
  const p = event.payload as { orderNumber?: string };
  await notifyStaffOfConfirmation(
    event.aggregateId,
    p.orderNumber ?? '',
    event.createdAt,
  );
}

async function handleChangesRequestedEmail(event: DomainEvent): Promise<void> {
  const p = event.payload as { comment?: string; orderNumber?: string };
  await notifyStaffOfChangeRequest(
    event.aggregateId,
    p.orderNumber ?? '',
    p.comment ?? '',
  );
}

async function handleColorSampleRequestedEmail(event: DomainEvent): Promise<void> {
  const p = event.payload as { orderNumber?: string };
  await notifyStaffOfColorSampleRequest(event.aggregateId, p.orderNumber ?? '');
}

// Best-effort: caught here rather than left to propagate, so a bounced/failed
// customer receipt doesn't mark the whole event 'failed' (which would strand
// it with no retry, even though Google Ads + the staff email already succeeded).
async function handleCustomerReceiptEmail(event: DomainEvent): Promise<void> {
  const p = event.payload as { orderNumber?: string };
  try {
    await notifyCustomerOfConfirmation(event.aggregateId, p.orderNumber ?? '', event.createdAt);
  } catch (err) {
    logger.error(`[outbox] customer receipt email failed for event ${event.id}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Workflow notifications
// ---------------------------------------------------------------------------
//
// Dispatch is safe to re-run: `notification_deliveries` claims each
// (event, person, channel) before sending, so a retried event notifies nobody a
// second time. That is what makes these handlers obey the contract in this
// file's header, which the older email handlers do not.

async function handleStageEnteredNotification(event: DomainEvent, tx: Transaction): Promise<void> {
  const p = event.payload as {
    stageSlug?: string;
    boardKey?: 'order' | 'purchase_order';
    poId?: string;
    actorEmail?: string;
  };
  if (!p.stageSlug || !p.boardKey) return;

  const stageName = await stageDisplayName(p.boardKey, p.stageSlug, tx);
  const entityId = p.boardKey === 'purchase_order' ? (p.poId ?? event.aggregateId) : event.aggregateId;

  await dispatchNotification('workflow.stage_entered', {
    dedupeKey: event.id,
    entityType: p.boardKey,
    entityId,
    stageSlug: p.stageSlug,
    boardKey: p.boardKey,
    actorEmail: p.actorEmail ?? null,
    title: `Work has reached ${stageName}`,
    body: 'A job has moved into a stage you own.',
    href: `/admin/orders/${event.aggregateId}?tab=checklist`,
  }, tx);
}

async function handleNoteAddedNotification(event: DomainEvent, tx: Transaction): Promise<void> {
  const p = event.payload as { authorLabel?: string; actorEmail?: string };
  await dispatchNotification('order.note_added', {
    dedupeKey: event.id,
    entityType: 'order',
    entityId: event.aggregateId,
    actorEmail: p.actorEmail ?? null,
    title: 'A note was added to an order',
    body: p.authorLabel ? `Added by ${p.authorLabel}.` : null,
    href: `/admin/orders/${event.aggregateId}?tab=notes`,
  }, tx);
}

async function handlePoSentNotification(event: DomainEvent, tx: Transaction): Promise<void> {
  const p = event.payload as { poId?: string; poNumber?: string };
  await dispatchNotification('po.sent', {
    dedupeKey: event.id,
    entityType: 'purchase_order',
    entityId: p.poId ?? event.aggregateId,
    title: `${p.poNumber ?? 'A purchase order'} has gone to the supplier`,
    href: `/admin/orders/${event.aggregateId}?tab=production`,
  }, tx);
}

async function handlePoSupplierUpdatedNotification(
  event: DomainEvent,
  tx: Transaction,
): Promise<void> {
  const p = event.payload as {
    poId?: string;
    poNumber?: string;
    from?: string;
    to?: string;
    supplierName?: string;
  };
  await dispatchNotification('po.supplier_updated', {
    dedupeKey: event.id,
    entityType: 'purchase_order',
    entityId: p.poId ?? event.aggregateId,
    title: `${p.supplierName ?? 'A supplier'} updated ${p.poNumber ?? 'a purchase order'}`,
    body: p.from && p.to ? `${p.from} → ${p.to}` : null,
    href: `/admin/orders/${event.aggregateId}?tab=production`,
  }, tx);
}

async function handleStatusReminderDueNotification(
  event: DomainEvent,
  tx: Transaction,
): Promise<void> {
  const p = event.payload as {
    entityType?: 'order' | 'purchase_order';
    entityId?: string;
    triggerStatus?: string;
    note?: string;
    staffUserId?: string;
  };
  if (!p.entityType || !p.entityId || !p.note || !p.staffUserId) return;

  await dispatchNotification('workflow.status_reminder', {
    dedupeKey: event.id,
    entityType: p.entityType,
    entityId: p.entityId,
    title: `Reminder: ${p.note}`,
    body: p.triggerStatus ? `Reached status "${p.triggerStatus}".` : null,
    href: `/admin/orders/${event.aggregateId}?tab=checklist`,
    forceRecipientIds: [p.staffUserId],
  }, tx);
}

/** Stage name for the message, falling back to the slug if it has been removed. */
async function stageDisplayName(
  boardKey: 'order' | 'purchase_order',
  slug: string,
  tx: Transaction,
): Promise<string> {
  // Queried through `tx` rather than the stages service, which uses the global
  // db — see the EventHandler note above.
  const [stage] = await tx
    .select({ name: workflowStages.name })
    .from(workflowStages)
    .where(and(eq(workflowStages.boardKey, boardKey), eq(workflowStages.slug, slug)));
  return stage?.name ?? slug;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Hub index snapshot push (fleet thread 2026-07-31-orders-from-email).
 * Registered on every event that can change the CRM chip or value — the
 * outbox is the one choke point every transition passes through, so the push
 * happens by construction (designflow's D1 lesson: wire it at the effects
 * layer or call sites forget). `strict` so a failed push retries with the
 * event's backoff; the push is an idempotent snapshot, so re-runs are safe.
 * The tx is passed through — the sync must not touch the global db from
 * inside the batch transaction.
 */
async function handleHubOrderIndexSync(event: DomainEvent, tx: Transaction): Promise<void> {
  const { syncOrderIndexToHub } = await import('@/server/hub/order-sync');
  await syncOrderIndexToHub(event.aggregateId, { executor: tx, strict: true });
}

/**
 * Hub communications-timeline push (mailflow's M3, salesflow's visibility
 * ruling): lifecycle events only. Deliberately NOT strict — the module never
 * throws — because a failure here would re-run this event's email handlers on
 * retry, and those resend (see the header). The hub ingest is idempotent on
 * (channel, externalRef = the event id), so the re-runs that do happen are
 * replay-safe. The `created` item is pushed from the create path in
 * orders/service.ts, which emits no outbox event.
 *
 * Must stay registered AFTER handleHubOrderIndexSync: handlers run in array
 * order, and the index sync stamps hub_order_id, which the timeline item
 * reads to link itself to the hub order row.
 */
async function handleHubTimelinePush(event: DomainEvent, tx: Transaction): Promise<void> {
  const { pushOrderTimelineEvent } = await import('@/server/hub/timeline');
  const kind = event.eventType === 'order.confirmed' ? 'confirmed' : 'changes_requested';
  const p = event.payload as { comment?: string };
  await pushOrderTimelineEvent(event.aggregateId, kind, {
    externalRef: event.id,
    occurredAt: event.createdAt,
    comment: p.comment ?? null,
    executor: tx,
  });
}

/**
 * ORDER NOTE (kind 'note') → hub timeline. Reinstated per salesflow's
 * 2026-08-04 reconciliation: David's widened ruling governs — order notes are
 * visible on the timeline with an order-scoped subject; the brokered
 * capability GET stays the current-state list (two-transport model).
 * Comments/discussion, supplier-authored and system rows never push. Reads
 * the note through the batch tx; same no-throw stance as the lifecycle push
 * (a hub outage cannot fail the event); hub externalRef dedupe makes replays
 * safe.
 */
async function handleHubNoteTimelinePush(event: DomainEvent, tx: Transaction): Promise<void> {
  const p = event.payload as { noteId?: string; authorKind?: string };
  if (!p.noteId || p.authorKind === 'supplier' || p.authorKind === 'system') return;

  const [note] = await tx
    .select({
      id: orderNotes.id,
      body: orderNotes.body,
      kind: orderNotes.kind,
      authorKind: orderNotes.authorKind,
      authorLabel: orderNotes.authorLabel,
      createdAt: orderNotes.createdAt,
      updatedAt: orderNotes.updatedAt,
      deletedAt: orderNotes.deletedAt,
    })
    .from(orderNotes)
    .where(eq(orderNotes.id, p.noteId));
  if (!note) return; // hard-deleted before the outbox ran — nothing to converge
  if (note.kind !== 'note') return; // comments/discussion stay off the timeline

  const { pushOrderNoteToTimeline } = await import('@/server/hub/timeline');
  // The row's CURRENT state, keyed on the row uuid (R1) — an add, edit and
  // delete of the same note all converge on one hub row; the hub's ordering
  // comparator sorts out-of-order deliveries.
  await pushOrderNoteToTimeline(event.aggregateId, note, {
    pushRef: event.id,
    executor: tx,
  });
}

/**
 * Configurable automations (David, 2026-08-06). One handler per supported
 * trigger, running inside the batch transaction like every other handler —
 * the rules service never throws, so a bad rule cannot fail its event.
 */
function automationHandler(
  trigger:
    | 'po_status_changed'
    | 'po_file_uploaded'
    | 'po_submitted_for_approval',
): EventHandler {
  return async (event, tx) => {
    const p = event.payload as { poId?: string; poNumber?: string };
    if (!p.poId) return;
    const { runAutomations } = await import('@/server/automations/service');
    await runAutomations(trigger, {
      tx,
      orderId: event.aggregateId,
      poId: p.poId,
      poNumber: p.poNumber ?? '',
      payload: event.payload as Record<string, unknown>,
    });
  };
}


async function handlePoSubmittedForApprovalNotification(
  event: DomainEvent,
  tx: Transaction,
): Promise<void> {
  const p = event.payload as {
    poId?: string;
    poNumber?: string;
    status?: string;
    supplierName?: string;
    note?: string | null;
  };
  await dispatchNotification('po.submitted_for_approval', {
    dedupeKey: event.id,
    entityType: 'purchase_order',
    entityId: p.poId ?? event.aggregateId,
    title: `${p.supplierName ?? 'A supplier'} submitted ${p.poNumber ?? 'a purchase order'} for approval`,
    body: p.note ?? (p.status ? `Finished: ${p.status.replace(/_/g, ' ')}.` : null),
    href: `/admin/purchase-orders/${p.poId ?? ''}`,
  }, tx);
}

const EVENT_HANDLERS: Record<string, EventHandler[]> = {
  'order.confirmed': [handleGoogleAdsConversion, handleConfirmationEmail, handleCustomerReceiptEmail, handleHubOrderIndexSync, handleHubTimelinePush],
  'order.changes_requested': [handleChangesRequestedEmail, handleHubOrderIndexSync, handleHubTimelinePush],
  'order.color_sample_requested': [handleColorSampleRequestedEmail],
  'order.note_added': [handleNoteAddedNotification, handleHubNoteTimelinePush],
  'order.note_updated': [handleHubNoteTimelinePush],
  'order.note_deleted': [handleHubNoteTimelinePush],
  'workflow.stage_entered': [handleStageEnteredNotification],
  'workflow.status_reminder_due': [handleStatusReminderDueNotification],
  'po.sent': [handlePoSentNotification, handleHubOrderIndexSync],
  'po.supplier_updated': [handlePoSupplierUpdatedNotification, handleHubOrderIndexSync],
  // Chip-affecting events with no other handler.
  'order.viewed': [handleHubOrderIndexSync],
  'order.updated': [handleHubOrderIndexSync],
  'order.cancelled': [handleHubOrderIndexSync],
  'order.status_changed': [handleHubOrderIndexSync],
  'po.created': [handleHubOrderIndexSync],
  'po.status_changed': [handleHubOrderIndexSync, automationHandler('po_status_changed')],
  'po.cancelled': [handleHubOrderIndexSync],
  'po.file_uploaded': [automationHandler('po_file_uploaded')],
  'po.submitted_for_approval': [
    handlePoSubmittedForApprovalNotification,
    automationHandler('po_submitted_for_approval'),
  ],
};

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export interface OutboxResult {
  processed: number;
  delivered: number;
  failed: number;
}

export async function processOutbox(): Promise<OutboxResult> {
  // The whole batch runs inside one transaction with FOR UPDATE SKIP LOCKED:
  // a concurrent cron invocation simply skips the rows this one has claimed,
  // so overlapping runs can never execute the same event's handlers twice
  // (previously a select-then-update race caused duplicate emails).
  return db.transaction(async (tx) => {
    const now = new Date();
    const due = await tx
      .select()
      .from(domainEvents)
      .where(
        or(
          eq(domainEvents.status, 'pending'),
          and(
            eq(domainEvents.status, 'failed'),
            lt(domainEvents.attempts, MAX_ATTEMPTS),
            or(isNull(domainEvents.nextAttemptAt), lte(domainEvents.nextAttemptAt, now)),
          ),
        ),
      )
      .orderBy(asc(domainEvents.createdAt))
      .limit(BATCH_SIZE)
      .for('update', { skipLocked: true });

    let delivered = 0;
    let failed = 0;

    for (const event of due) {
      const handlers = EVENT_HANDLERS[event.eventType];

      if (!handlers || handlers.length === 0) {
        // No handlers — mark delivered so it doesn't stall the queue.
        await markDelivered(tx, event.id, event.status);
        delivered++;
        continue;
      }

      let anyFailed = false;
      for (const handler of handlers) {
        try {
          await handler(event, tx);
        } catch (err) {
          logger.error(
            `[outbox] handler failed for event ${event.id} (${event.eventType}):`,
            err,
          );
          anyFailed = true;
        }
      }

      if (anyFailed) {
        const wentDead = await markFailedOrDead(tx, event.id, event.status, event.attempts);
        if (wentDead) {
          // Alert-worthy signal (roadmap 3.4): a dead-lettered event has exhausted
          // all retries and needs human attention — routed through logger.error()
          // so it reaches Sentry (when configured), not just the dashboard tile.
          logger.error('[outbox] event dead-lettered after max attempts', {
            eventId: event.id,
            eventType: event.eventType,
            aggregateId: event.aggregateId,
            attempts: event.attempts + 1,
          });
        }
        failed++;
      } else {
        await markDelivered(tx, event.id, event.status);
        delivered++;
      }
    }

    return { processed: due.length, delivered, failed };
  });
}

/**
 * Admin "Retry now" redrive: resets a failed/dead event to 'pending' with a
 * clean attempt counter so the next processOutbox() run picks it straight up.
 * Returns false if the id doesn't exist or isn't currently failed/dead.
 */
export async function redriveEvent(id: string): Promise<boolean> {
  const updated = await db
    .update(domainEvents)
    .set({ status: 'pending', attempts: 0, nextAttemptAt: null })
    .where(and(eq(domainEvents.id, id), inArray(domainEvents.status, ['failed', 'dead'])))
    .returning({ id: domainEvents.id });
  return updated.length > 0;
}

export interface FailedEventSummary {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: 'failed' | 'dead';
  attempts: number;
  createdAt: Date;
  nextAttemptAt: Date | null;
}

/** Most recent failed/dead events, for the admin dashboard widget. */
export async function listFailedEvents(limit = 20): Promise<FailedEventSummary[]> {
  const rows = await db
    .select({
      id: domainEvents.id,
      eventType: domainEvents.eventType,
      aggregateType: domainEvents.aggregateType,
      aggregateId: domainEvents.aggregateId,
      status: domainEvents.status,
      attempts: domainEvents.attempts,
      createdAt: domainEvents.createdAt,
      nextAttemptAt: domainEvents.nextAttemptAt,
    })
    .from(domainEvents)
    .where(inArray(domainEvents.status, ['failed', 'dead']))
    .orderBy(desc(domainEvents.createdAt))
    .limit(limit);
  return rows as FailedEventSummary[];
}

/** Total counts backing the dashboard's "Failed events" stat tile. */
export async function countFailedEvents(): Promise<{ failed: number; dead: number }> {
  const rows = await db
    .select({ status: domainEvents.status, n: count() })
    .from(domainEvents)
    .where(inArray(domainEvents.status, ['failed', 'dead']))
    .groupBy(domainEvents.status);
  const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return { failed: map.failed ?? 0, dead: map.dead ?? 0 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markDelivered(
  tx: Transaction,
  id: string,
  fromStatus: DomainEvent['status'],
): Promise<void> {
  await tx
    .update(domainEvents)
    .set({ status: 'delivered', deliveredAt: new Date(), nextAttemptAt: null })
    .where(and(eq(domainEvents.id, id), eq(domainEvents.status, fromStatus)));
}

/** Returns true when this failure exhausted retries and the event went 'dead'. */
async function markFailedOrDead(
  tx: Transaction,
  id: string,
  fromStatus: DomainEvent['status'],
  priorAttempts: number,
): Promise<boolean> {
  const attempts = priorAttempts + 1;

  if (attempts >= MAX_ATTEMPTS) {
    await tx
      .update(domainEvents)
      .set({ status: 'dead', attempts, nextAttemptAt: null })
      .where(and(eq(domainEvents.id, id), eq(domainEvents.status, fromStatus)));
    return true;
  }

  const nextAttemptAt = new Date(Date.now() + BACKOFF_MINUTES[attempts - 1] * 60_000);
  await tx
    .update(domainEvents)
    .set({ status: 'failed', attempts, nextAttemptAt })
    .where(and(eq(domainEvents.id, id), eq(domainEvents.status, fromStatus)));
  return false;
}
