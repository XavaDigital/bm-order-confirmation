/**
 * Outbox processor — picks up pending domain_events rows and delivers them to
 * their registered handlers (Google Ads conversion, staff email, future webhook).
 *
 * Call processOutbox() from a cron endpoint (POST /api/internal/process-outbox).
 * Each event is marked 'delivered' when all handlers succeed, or 'failed' if
 * any handler throws. The WHERE status='pending' guard on the UPDATE acts as an
 * optimistic lock: concurrent runs that grab the same event will simply no-op
 * on the second update, and both handlers are idempotent or low-risk.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { domainEvents } from '@/db/schema';
import { fireGoogleAdsConversion } from '@/server/conversions/google-ads';
import {
  notifyStaffOfConfirmation,
  notifyStaffOfChangeRequest,
} from '@/server/orders/notifications';

const BATCH_SIZE = 20;

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

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const EVENT_HANDLERS: Record<string, EventHandler[]> = {
  'order.confirmed': [handleGoogleAdsConversion, handleConfirmationEmail],
  'order.changes_requested': [handleChangesRequestedEmail],
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
  const pending = await db
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.status, 'pending'))
    .orderBy(asc(domainEvents.createdAt))
    .limit(BATCH_SIZE);

  let delivered = 0;
  let failed = 0;

  for (const event of pending) {
    const handlers = EVENT_HANDLERS[event.eventType];

    if (!handlers || handlers.length === 0) {
      // No handlers — mark delivered so it doesn't stall the queue.
      await markDelivered(event.id);
      delivered++;
      continue;
    }

    let anyFailed = false;
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error(
          `[outbox] handler failed for event ${event.id} (${event.eventType}):`,
          err,
        );
        anyFailed = true;
      }
    }

    if (anyFailed) {
      await markFailed(event.id);
      failed++;
    } else {
      await markDelivered(event.id);
      delivered++;
    }
  }

  return { processed: pending.length, delivered, failed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markDelivered(id: string): Promise<void> {
  await db
    .update(domainEvents)
    .set({ status: 'delivered', deliveredAt: new Date() })
    .where(and(eq(domainEvents.id, id), eq(domainEvents.status, 'pending')));
}

async function markFailed(id: string): Promise<void> {
  await db
    .update(domainEvents)
    .set({ status: 'failed' })
    .where(and(eq(domainEvents.id, id), eq(domainEvents.status, 'pending')));
}
