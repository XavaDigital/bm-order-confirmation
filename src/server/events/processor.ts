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
import { db } from '@/db';
import { domainEvents } from '@/db/schema';
import { fireGoogleAdsConversion } from '@/server/conversions/google-ads';
import {
  notifyStaffOfConfirmation,
  notifyStaffOfChangeRequest,
  notifyStaffOfColorSampleRequest,
  notifyCustomerOfConfirmation,
} from '@/server/orders/notifications';
import { logger } from '@/lib/logger';

const BATCH_SIZE = 20;

// Exponential backoff schedule, indexed by attempt number (1st failure → 1m, ...,
// 5th failure → 12h). Once attempts reaches BACKOFF_MINUTES.length the event is
// dead-lettered instead of scheduled again.
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

type DomainEvent = typeof domainEvents.$inferSelect;
type EventHandler = (event: DomainEvent) => Promise<void>;

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
// Registry
// ---------------------------------------------------------------------------

const EVENT_HANDLERS: Record<string, EventHandler[]> = {
  'order.confirmed': [handleGoogleAdsConversion, handleConfirmationEmail, handleCustomerReceiptEmail],
  'order.changes_requested': [handleChangesRequestedEmail],
  'order.color_sample_requested': [handleColorSampleRequestedEmail],
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
  const now = new Date();
  const due = await db
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
    .limit(BATCH_SIZE);

  let delivered = 0;
  let failed = 0;

  for (const event of due) {
    const handlers = EVENT_HANDLERS[event.eventType];

    if (!handlers || handlers.length === 0) {
      // No handlers — mark delivered so it doesn't stall the queue.
      await markDelivered(event.id, event.status);
      delivered++;
      continue;
    }

    let anyFailed = false;
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        logger.error(
          `[outbox] handler failed for event ${event.id} (${event.eventType}):`,
          err,
        );
        anyFailed = true;
      }
    }

    if (anyFailed) {
      const wentDead = await markFailedOrDead(event.id, event.status, event.attempts);
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
      await markDelivered(event.id, event.status);
      delivered++;
    }
  }

  return { processed: due.length, delivered, failed };
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

async function markDelivered(id: string, fromStatus: DomainEvent['status']): Promise<void> {
  await db
    .update(domainEvents)
    .set({ status: 'delivered', deliveredAt: new Date(), nextAttemptAt: null })
    .where(and(eq(domainEvents.id, id), eq(domainEvents.status, fromStatus)));
}

/** Returns true when this failure exhausted retries and the event went 'dead'. */
async function markFailedOrDead(
  id: string,
  fromStatus: DomainEvent['status'],
  priorAttempts: number,
): Promise<boolean> {
  const attempts = priorAttempts + 1;

  if (attempts >= MAX_ATTEMPTS) {
    await db
      .update(domainEvents)
      .set({ status: 'dead', attempts, nextAttemptAt: null })
      .where(and(eq(domainEvents.id, id), eq(domainEvents.status, fromStatus)));
    return true;
  }

  const nextAttemptAt = new Date(Date.now() + BACKOFF_MINUTES[attempts - 1] * 60_000);
  await db
    .update(domainEvents)
    .set({ status: 'failed', attempts, nextAttemptAt })
    .where(and(eq(domainEvents.id, id), eq(domainEvents.status, fromStatus)));
  return false;
}
