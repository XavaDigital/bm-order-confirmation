import { afterEach, describe, expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/server/conversions/google-ads', () => ({ fireGoogleAdsConversion: vi.fn() }));
vi.mock('@/server/orders/notifications', () => ({
  notifyStaffOfConfirmation: vi.fn(),
  notifyStaffOfChangeRequest: vi.fn(),
  notifyCustomerOfConfirmation: vi.fn(),
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { processOutbox, redriveEvent, listFailedEvents, countFailedEvents } from './processor';
import { fireGoogleAdsConversion } from '@/server/conversions/google-ads';
import {
  notifyStaffOfConfirmation,
  notifyStaffOfChangeRequest,
  notifyCustomerOfConfirmation,
} from '@/server/orders/notifications';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(fireGoogleAdsConversion).mockReset();
  vi.mocked(notifyStaffOfConfirmation).mockReset();
  vi.mocked(notifyStaffOfChangeRequest).mockReset();
  vi.mocked(notifyCustomerOfConfirmation).mockReset();
});

const FAKE_ORDER_ID = '11111111-1111-1111-1111-111111111111';

async function seedEvent(overrides: Partial<typeof schema.domainEvents.$inferInsert> = {}) {
  const [event] = await db
    .insert(schema.domainEvents)
    .values({
      aggregateType: 'order',
      aggregateId: FAKE_ORDER_ID,
      eventType: 'order.confirmed',
      payload: {},
      status: 'pending',
      ...overrides,
    })
    .returning();
  return event;
}

describe('processOutbox', () => {
  it('processes up to BATCH_SIZE=20 oldest-first', async () => {
    const seeded: (typeof schema.domainEvents.$inferInsert & { id: string })[] = [];
    for (let i = 0; i < 25; i++) {
      const event = await seedEvent({
        eventType: 'order.viewed', // no handlers -> immediately delivered, simplest to assert ordering
        createdAt: new Date(Date.now() - (25 - i) * 1000),
      });
      seeded.push(event as typeof event & { id: string });
    }

    const result = await processOutbox();

    expect(result.processed).toBe(20);
    expect(result.delivered).toBe(20);
    expect(result.failed).toBe(0);

    const oldest20Ids = seeded.slice(0, 20).map((e) => e.id).sort();
    const deliveredRows = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.status, 'delivered'));
    expect(deliveredRows.map((r) => r.id).sort()).toEqual(oldest20Ids);
  });

  it('order.confirmed calls Google Ads, staff email, and customer receipt handlers, ends up delivered', async () => {
    const event = await seedEvent({ eventType: 'order.confirmed', payload: { orderNumber: 'OC-1' } });

    const result = await processOutbox();

    expect(result).toEqual({ processed: 1, delivered: 1, failed: 0 });
    expect(fireGoogleAdsConversion).toHaveBeenCalledTimes(1);
    expect(fireGoogleAdsConversion).toHaveBeenCalledWith(FAKE_ORDER_ID);
    expect(notifyStaffOfConfirmation).toHaveBeenCalledTimes(1);
    expect(notifyCustomerOfConfirmation).toHaveBeenCalledTimes(1);
    expect(notifyCustomerOfConfirmation).toHaveBeenCalledWith(FAKE_ORDER_ID, 'OC-1', event.createdAt);
    expect(notifyStaffOfChangeRequest).not.toHaveBeenCalled();

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('delivered');
  });

  it('a failing customer receipt email does not fail the order.confirmed event (best-effort)', async () => {
    vi.mocked(notifyCustomerOfConfirmation).mockRejectedValueOnce(new Error('smtp bounce'));
    const event = await seedEvent({ eventType: 'order.confirmed', payload: { orderNumber: 'OC-1' } });

    const result = await processOutbox();

    expect(result).toEqual({ processed: 1, delivered: 1, failed: 0 });
    expect(fireGoogleAdsConversion).toHaveBeenCalledTimes(1);
    expect(notifyStaffOfConfirmation).toHaveBeenCalledTimes(1);
    expect(notifyCustomerOfConfirmation).toHaveBeenCalledTimes(1);

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('delivered');
  });

  it('order.changes_requested calls only its handler', async () => {
    await seedEvent({ eventType: 'order.changes_requested', payload: { comment: 'x', orderNumber: 'OC-1' } });

    const result = await processOutbox();

    expect(result).toEqual({ processed: 1, delivered: 1, failed: 0 });
    expect(notifyStaffOfChangeRequest).toHaveBeenCalledTimes(1);
    expect(fireGoogleAdsConversion).not.toHaveBeenCalled();
    expect(notifyStaffOfConfirmation).not.toHaveBeenCalled();
  });

  it('an unhandled event type is immediately delivered with no handler calls', async () => {
    const event = await seedEvent({ eventType: 'token.generated', payload: {} });

    const result = await processOutbox();

    expect(result).toEqual({ processed: 1, delivered: 1, failed: 0 });
    expect(fireGoogleAdsConversion).not.toHaveBeenCalled();
    expect(notifyStaffOfConfirmation).not.toHaveBeenCalled();
    expect(notifyStaffOfChangeRequest).not.toHaveBeenCalled();

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('delivered');
  });

  it('marks the event failed if one handler rejects, but still runs the other handler (no short-circuit)', async () => {
    vi.mocked(fireGoogleAdsConversion).mockRejectedValueOnce(new Error('ads failed'));
    const event = await seedEvent({ eventType: 'order.confirmed', payload: { orderNumber: 'OC-1' } });

    const result = await processOutbox();

    expect(result).toEqual({ processed: 1, delivered: 0, failed: 1 });
    expect(fireGoogleAdsConversion).toHaveBeenCalledTimes(1);
    expect(notifyStaffOfConfirmation).toHaveBeenCalledTimes(1);

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('failed');
  });

  it('calling processOutbox twice against already-delivered rows no-ops the second time', async () => {
    await seedEvent({ eventType: 'order.viewed' });

    const first = await processOutbox();
    expect(first).toEqual({ processed: 1, delivered: 1, failed: 0 });

    const second = await processOutbox();
    expect(second).toEqual({ processed: 0, delivered: 0, failed: 0 });
  });

  it('a fresh failure sets attempts=1 and a ~1 minute next_attempt_at, and is not re-selected before then', async () => {
    vi.mocked(fireGoogleAdsConversion).mockRejectedValueOnce(new Error('ads failed'));
    const event = await seedEvent({ eventType: 'order.confirmed', payload: { orderNumber: 'OC-1' } });

    const result = await processOutbox();
    expect(result).toEqual({ processed: 1, delivered: 0, failed: 1 });

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('failed');
    expect(row!.attempts).toBe(1);
    expect(row!.nextAttemptAt).not.toBeNull();
    const delayMs = row!.nextAttemptAt!.getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(50_000); // ~1 minute backoff, allow test-runtime slack
    expect(delayMs).toBeLessThanOrEqual(60_000);

    // Not due yet — a second run should skip it entirely.
    const second = await processOutbox();
    expect(second).toEqual({ processed: 0, delivered: 0, failed: 0 });
  });

  it('retries a failed event once next_attempt_at has passed, incrementing attempts again on repeat failure', async () => {
    vi.mocked(fireGoogleAdsConversion).mockRejectedValue(new Error('ads failed'));
    const event = await seedEvent({
      eventType: 'order.confirmed',
      payload: { orderNumber: 'OC-1' },
      status: 'failed',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() - 1000), // already due
    });

    const result = await processOutbox();
    expect(result).toEqual({ processed: 1, delivered: 0, failed: 1 });

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('failed');
    expect(row!.attempts).toBe(2);
    expect(fireGoogleAdsConversion).toHaveBeenCalledTimes(1);
  });

  it('a retry that succeeds re-runs every handler for the event, not just the one that failed', async () => {
    vi.mocked(fireGoogleAdsConversion).mockResolvedValue(undefined);
    await seedEvent({
      eventType: 'order.confirmed',
      payload: { orderNumber: 'OC-1' },
      status: 'failed',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
    });

    const result = await processOutbox();

    expect(result).toEqual({ processed: 1, delivered: 1, failed: 0 });
    expect(fireGoogleAdsConversion).toHaveBeenCalledTimes(1);
    expect(notifyStaffOfConfirmation).toHaveBeenCalledTimes(1);
    expect(notifyCustomerOfConfirmation).toHaveBeenCalledTimes(1);
  });

  it('dead-letters an event once it fails for the 5th time, and stops selecting it', async () => {
    vi.mocked(fireGoogleAdsConversion).mockRejectedValue(new Error('ads failed'));
    const event = await seedEvent({
      eventType: 'order.confirmed',
      payload: { orderNumber: 'OC-1' },
      status: 'failed',
      attempts: 4,
      nextAttemptAt: new Date(Date.now() - 1000),
    });

    const result = await processOutbox();
    expect(result).toEqual({ processed: 1, delivered: 0, failed: 1 });

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('dead');
    expect(row!.attempts).toBe(5);
    expect(row!.nextAttemptAt).toBeNull();

    const second = await processOutbox();
    expect(second).toEqual({ processed: 0, delivered: 0, failed: 0 });
  });
});

describe('redriveEvent', () => {
  it('resets a failed event to pending with a clean attempt counter', async () => {
    const event = await seedEvent({
      status: 'failed',
      attempts: 3,
      nextAttemptAt: new Date(Date.now() + 999_999),
    });

    const ok = await redriveEvent(event.id);
    expect(ok).toBe(true);

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(0);
    expect(row!.nextAttemptAt).toBeNull();
  });

  it('resets a dead event to pending too', async () => {
    const event = await seedEvent({ status: 'dead', attempts: 5 });

    const ok = await redriveEvent(event.id);
    expect(ok).toBe(true);

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('pending');
  });

  it('returns false for an event that is not failed/dead', async () => {
    const event = await seedEvent({ status: 'delivered', deliveredAt: new Date() });
    const ok = await redriveEvent(event.id);
    expect(ok).toBe(false);
  });

  it('returns false for an unknown id', async () => {
    const ok = await redriveEvent('00000000-0000-0000-0000-000000000000');
    expect(ok).toBe(false);
  });

  it('a redriven event is picked up and delivered on the next processOutbox() run', async () => {
    vi.mocked(fireGoogleAdsConversion).mockResolvedValue(undefined);
    const event = await seedEvent({
      eventType: 'order.confirmed',
      payload: { orderNumber: 'OC-1' },
      status: 'dead',
      attempts: 5,
    });

    await redriveEvent(event.id);
    const result = await processOutbox();

    expect(result).toEqual({ processed: 1, delivered: 1, failed: 0 });
    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('delivered');
  });
});

describe('listFailedEvents / countFailedEvents', () => {
  it('returns only failed/dead events, newest first, and counts them by status', async () => {
    await seedEvent({ eventType: 'order.viewed', status: 'delivered', deliveredAt: new Date() });
    await seedEvent({ eventType: 'order.confirmed', status: 'pending' });
    const older = await seedEvent({
      eventType: 'order.confirmed',
      status: 'failed',
      attempts: 2,
      createdAt: new Date(Date.now() - 60_000),
    });
    const newer = await seedEvent({
      eventType: 'order.changes_requested',
      status: 'dead',
      attempts: 5,
      createdAt: new Date(),
    });

    const list = await listFailedEvents();
    expect(list.map((e) => e.id)).toEqual([newer.id, older.id]);

    const counts = await countFailedEvents();
    expect(counts).toEqual({ failed: 1, dead: 1 });
  });

  it('returns zero counts and an empty list when nothing has failed', async () => {
    await seedEvent({ eventType: 'order.viewed', status: 'delivered', deliveredAt: new Date() });

    expect(await listFailedEvents()).toEqual([]);
    expect(await countFailedEvents()).toEqual({ failed: 0, dead: 0 });
  });
});
