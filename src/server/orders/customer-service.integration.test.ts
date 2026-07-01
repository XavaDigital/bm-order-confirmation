import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    uploadFile: vi.fn().mockResolvedValue('mock-signature-key'),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from './contract';
import { createOrder, generateAccessToken, revokeAccessToken } from './service';
import {
  getOrderForCustomer,
  recordOrderViewed,
  requestOrderChanges,
  confirmOrder,
  REQUIRED_ACK_KEYS,
  ACK_TEXT_VERSION,
  type AckInput,
} from './customer-service';
import { uploadFile } from '@/lib/storage';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(uploadFile).mockClear();
});

async function seedSizeChart(name = 'Adult Unisex') {
  const [chart] = await db.insert(schema.sizeCharts).values({ name }).returning();
  return chart;
}

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function allAcks(): AckInput[] {
  return REQUIRED_ACK_KEYS.map((key) => ({ key, text: `ack for ${key}` }));
}

describe('getOrderForCustomer', () => {
  it('returns null for an unknown token', async () => {
    expect(await getOrderForCustomer('unknown')).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    const created = await createOrder(minimalInput());
    await revokeAccessToken(created.orderId);
    expect(await getOrderForCustomer(created.token)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const created = await createOrder(minimalInput());
    await db
      .update(schema.orderAccess)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orderAccess.orderId, created.orderId));
    expect(await getOrderForCustomer(created.token)).toBeNull();
  });

  it('returns the full nested shape, including resolved size-chart names, for a valid token', async () => {
    const chart = await seedSizeChart('Womens Chart');
    const created = await createOrder(
      minimalInput({
        garments: [{ name: 'Jersey', sizing: [{ size: 'M' }], sizeChartIds: [chart.id] }],
      }),
    );

    const result = await getOrderForCustomer(created.token);
    expect(result).not.toBeNull();
    expect(result!.order.garments[0].sizing).toHaveLength(1);
    expect(result!.order.garments[0].sizeChartLinks[0].sizeChart.name).toBe('Womens Chart');
  });
});

describe('recordOrderViewed', () => {
  it('transitions sent -> viewed, updates lastViewedAt, and emits order.viewed on first view', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateAccessToken(created.orderId); // draft -> sent, revokes created.token
    const { order, access } = (await getOrderForCustomer(token))!;

    await recordOrderViewed(order.id, access.id, order.status);

    const updated = await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
    expect(updated!.status).toBe('viewed');

    const updatedAccess = await db.query.orderAccess.findFirst({
      where: eq(schema.orderAccess.id, access.id),
    });
    expect(updatedAccess!.lastViewedAt).not.toBeNull();

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, order.id));
    expect(events.filter((e) => e.eventType === 'order.viewed')).toHaveLength(1);
  });

  it('is idempotent on a second view (no duplicate order.viewed event)', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateAccessToken(created.orderId);
    const first = (await getOrderForCustomer(token))!;
    await recordOrderViewed(first.order.id, first.access.id, first.order.status);

    const second = (await getOrderForCustomer(token))!;
    await recordOrderViewed(second.order.id, second.access.id, second.order.status);

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, first.order.id));
    expect(events.filter((e) => e.eventType === 'order.viewed')).toHaveLength(1);
  });
});

describe('requestOrderChanges', () => {
  it('transitions the order to changes_requested and emits an event with the comment', async () => {
    const created = await createOrder(minimalInput());
    const result = await requestOrderChanges({
      rawToken: created.token,
      comment: 'Please fix the sizing',
    });
    expect(result.orderId).toBe(created.orderId);

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.status).toBe('changes_requested');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    const event = events.find((e) => e.eventType === 'order.changes_requested');
    expect(event).toBeDefined();
    expect((event!.payload as { comment: string }).comment).toBe('Please fix the sizing');
  });

  it('throws invalid_token for an unknown token', async () => {
    await expect(
      requestOrderChanges({ rawToken: 'bogus', comment: 'x' }),
    ).rejects.toThrow('invalid_token');
  });

  it('throws already_confirmed if the order is already confirmed', async () => {
    const created = await createOrder(minimalInput());
    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
    });
    await expect(
      requestOrderChanges({ rawToken: created.token, comment: 'x' }),
    ).rejects.toThrow('already_confirmed');
  });
});

describe('confirmOrder', () => {
  it('full happy path: writes acks, confirmation snapshot, conversion event, domain event, and marks confirmed', async () => {
    const chart = await seedSizeChart('Adult Unisex');
    const created = await createOrder(
      minimalInput({
        orderValue: { amount: 500, currency: 'NZD' },
        garments: [
          {
            name: 'Home Jersey',
            sizing: [{ size: 'M', playerName: 'A. Smith', playerNumber: '7' }],
            sizeChartIds: [chart.id],
          },
        ],
      }),
    );

    const result = await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      concerns: 'None',
      signatureType: 'none',
      ipAddress: '203.0.113.5',
      userAgent: 'vitest',
    });

    expect(result.orderId).toBe(created.orderId);

    const ackRows = await db
      .select()
      .from(schema.acknowledgments)
      .where(eq(schema.acknowledgments.orderId, created.orderId));
    expect(ackRows).toHaveLength(7);
    expect(ackRows.every((a) => a.accepted && a.ackTextVersion === ACK_TEXT_VERSION)).toBe(true);

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows).toHaveLength(1);
    const snapshot = confirmationRows[0].confirmedSnapshot as {
      garments: { size_chart_names: string[] }[];
    };
    expect(snapshot.garments[0].size_chart_names).toEqual(['Adult Unisex']);

    const conversionRows = await db
      .select()
      .from(schema.conversionEvents)
      .where(eq(schema.conversionEvents.orderId, created.orderId));
    expect(conversionRows).toHaveLength(1);
    expect(conversionRows[0].status).toBe('pending');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    expect(events.filter((e) => e.eventType === 'order.confirmed')).toHaveLength(1);

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.status).toBe('confirmed');
    expect(order!.confirmedAt).not.toBeNull();

    const access = await db.query.orderAccess.findFirst({
      where: eq(schema.orderAccess.orderId, created.orderId),
    });
    expect(access!.lastViewedAt).not.toBeNull();
  });

  it('uploads a drawn signature and stores the returned storage key', async () => {
    const created = await createOrder(minimalInput());

    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'drawn',
      signatureBase64: 'data:image/png;base64,aGVsbG8=',
    });

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [key, buffer, mime] = vi.mocked(uploadFile).mock.calls[0];
    expect(buffer.toString()).toBe('hello');
    expect(mime).toBe('image/png');
    expect(key).toMatch(new RegExp(`^signatures/${created.orderId}/.+\\.png$`));

    // confirmOrder stores the pure signatureKey() result, not uploadFile's
    // (discarded) return value.
    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows[0].signatureStorageKey).toBe(key);
  });

  it('rejects when a required ack is missing, writing no rows', async () => {
    const created = await createOrder(minimalInput());
    const incomplete = allAcks().slice(0, 6);

    await expect(
      confirmOrder({ rawToken: created.token, acks: incomplete, signatureType: 'none' }),
    ).rejects.toThrow(/^missing_ack:/);

    const ackRows = await db
      .select()
      .from(schema.acknowledgments)
      .where(eq(schema.acknowledgments.orderId, created.orderId));
    expect(ackRows).toHaveLength(0);
    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows).toHaveLength(0);
  });

  it('rejects a second confirm attempt on an already-confirmed order', async () => {
    const created = await createOrder(minimalInput());
    await confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' });

    await expect(
      confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('already_confirmed');

    const confirmationRows = await db
      .select()
      .from(schema.confirmations)
      .where(eq(schema.confirmations.orderId, created.orderId));
    expect(confirmationRows).toHaveLength(1);
  });

  it('rejects unknown, revoked, and expired tokens', async () => {
    await expect(
      confirmOrder({ rawToken: 'bogus', acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('invalid_token');

    const revoked = await createOrder(minimalInput());
    await revokeAccessToken(revoked.orderId);
    await expect(
      confirmOrder({ rawToken: revoked.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('invalid_token');

    const expired = await createOrder(minimalInput());
    await db
      .update(schema.orderAccess)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.orderAccess.orderId, expired.orderId));
    await expect(
      confirmOrder({ rawToken: expired.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow('invalid_token');
  });

  it('updates orders.shippingAddress only when shippingMode is customer_entered', async () => {
    const customerEntered = await createOrder(
      minimalInput({ shipping: { mode: 'customer_entered' } }),
    );
    await confirmOrder({
      rawToken: customerEntered.token,
      acks: allAcks(),
      signatureType: 'none',
      shippingAddress: { line1: '1 Beast St' },
    });
    const order1 = await db.query.orders.findFirst({
      where: eq(schema.orders.id, customerEntered.orderId),
    });
    expect(order1!.shippingAddress).toEqual({ line1: '1 Beast St' });

    const prefilled = await createOrder(minimalInput({ shipping: { mode: 'prefilled' } }));
    await confirmOrder({
      rawToken: prefilled.token,
      acks: allAcks(),
      signatureType: 'none',
      shippingAddress: { line1: 'should be ignored' },
    });
    const order2 = await db.query.orders.findFirst({
      where: eq(schema.orders.id, prefilled.orderId),
    });
    expect(order2!.shippingAddress).toBeNull();
  });

  it('rolls back the whole transaction if an insert fails mid-way (atomicity)', async () => {
    const created = await createOrder(minimalInput());
    // Pre-insert a confirmations row directly (bypassing confirmOrder) without
    // flipping order status, so confirmOrder's own insert of `confirmations`
    // (which has a unique orderId constraint) fails mid-transaction.
    await db.insert(schema.confirmations).values({
      orderId: created.orderId,
      confirmedSnapshot: { pre: 'existing' },
    });

    await expect(
      confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' }),
    ).rejects.toThrow();

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.status).not.toBe('confirmed');

    const events = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, created.orderId));
    expect(events.filter((e) => e.eventType === 'order.confirmed')).toHaveLength(0);

    const ackRows = await db
      .select()
      .from(schema.acknowledgments)
      .where(eq(schema.acknowledgments.orderId, created.orderId));
    expect(ackRows).toHaveLength(0);
  });
});
