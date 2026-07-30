import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { confirmOrder, requestOrderChanges, REQUIRED_ACK_KEYS } from '@/server/orders/customer-service';
import { getMetricsData } from './queries';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function allAcks() {
  return REQUIRED_ACK_KEYS.map((key) => ({ key, text: `ack for ${key}` }));
}

async function seedLinkEmailed(orderId: string, createdAt: Date) {
  await db.insert(schema.auditEvents).values({
    aggregateType: 'order',
    aggregateId: orderId,
    eventType: 'link.emailed',
    payload: {},
    createdAt,
  });
}

describe('getMetricsData', () => {
  it('computes avgSentToConfirmDays from the first link.emailed audit event, not order creation', async () => {
    const created = await createOrder(minimalOrderInput());
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    // A resend a day later must not push the average up — only the earliest send counts.
    await seedLinkEmailed(created.orderId, threeDaysAgo);
    await seedLinkEmailed(created.orderId, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

    await confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' });

    const data = await getMetricsData();

    expect(data.avgSentToConfirmDays).not.toBeNull();
    expect(data.avgSentToConfirmDays!).toBeGreaterThan(2.9);
    expect(data.avgSentToConfirmDays!).toBeLessThan(3.1);
  });

  it('returns null avgSentToConfirmDays when no confirmed order has a link.emailed event', async () => {
    const created = await createOrder(minimalOrderInput());
    // Confirm without ever having "sent" it via the normal flow (e.g. a
    // capability-created order confirmed directly) — no audit row to join against.
    await confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' });

    const data = await getMetricsData();

    expect(data.avgSentToConfirmDays).toBeNull();
  });

  it('buckets confirmed order value into the month it was confirmed, not created', async () => {
    const created = await createOrder(minimalOrderInput({ orderValue: { amount: 500, currency: 'NZD' } }));
    await confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' });

    const data = await getMetricsData();

    expect(data.conversionValueTrend).toHaveLength(6);
    const currentMonth = data.conversionValueTrend[data.conversionValueTrend.length - 1];
    expect(currentMonth.valueNZD).toBe(500);
    // Every other month in the 6-month window is empty in this seed.
    const total = data.conversionValueTrend.reduce((sum, m) => sum + m.valueNZD, 0);
    expect(total).toBe(500);
  });

  it('computes changesRequestedRatePct over every order ever sent, same denominator as confirmationRatePct', async () => {
    const confirmed = await createOrder(minimalOrderInput());
    await confirmOrder({ rawToken: confirmed.token, acks: allAcks(), signatureType: 'none' });

    const changesRequested = await createOrder(minimalOrderInput({ customer: { name: 'Bob', email: 'bob@example.com' } }));
    await db.update(schema.orders).set({ status: 'sent' }).where(eq(schema.orders.id, changesRequested.orderId));
    await requestOrderChanges({ rawToken: changesRequested.token, comment: 'Please resize' });

    const data = await getMetricsData();

    // everSentCount = 1 confirmed + 1 changes_requested = 2
    expect(data.confirmationRatePct).toBeCloseTo(50, 5);
    expect(data.changesRequestedRatePct).toBeCloseTo(50, 5);
  });

  it('returns 0 for both rates when nothing has ever been sent', async () => {
    await createOrder(minimalOrderInput());

    const data = await getMetricsData();

    expect(data.confirmationRatePct).toBe(0);
    expect(data.changesRequestedRatePct).toBe(0);
  });
});
