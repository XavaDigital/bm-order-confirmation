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
import {
  emitDomainEvent,
  recordAuditEvent,
  getChangesRequestedComment,
  getChangesRequestedCount,
  getOrderAuditLog,
} from './outbox';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedOrder(overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: `OC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      customerName: 'Jane Coach',
      customerEmail: 'jane@example.com',
      ...overrides,
    })
    .returning();
  return order;
}

describe('emitDomainEvent', () => {
  it('inserts a domain_events row inside a transaction', async () => {
    const order = await seedOrder();

    await db.transaction(async (tx) => {
      await emitDomainEvent(tx, {
        aggregateId: order.id,
        eventType: 'order.viewed',
        payload: { foo: 'bar' },
      });
    });

    const rows = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('order.viewed');
    expect(rows[0].aggregateType).toBe('order');
  });

  it('rolls back the event insert if the transaction later throws', async () => {
    const order = await seedOrder();

    await expect(
      db.transaction(async (tx) => {
        await emitDomainEvent(tx, {
          aggregateId: order.id,
          eventType: 'order.viewed',
          payload: {},
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const rows = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, order.id));
    expect(rows).toHaveLength(0);
  });
});

describe('recordAuditEvent', () => {
  it('inserts directly with status=delivered', async () => {
    const order = await seedOrder();

    await recordAuditEvent({
      aggregateId: order.id,
      eventType: 'token.generated',
      payload: {},
    });

    const rows = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('delivered');
    expect(rows[0].deliveredAt).not.toBeNull();
  });
});

describe('getChangesRequestedComment', () => {
  it('returns null when none exist', async () => {
    const order = await seedOrder();
    expect(await getChangesRequestedComment(order.id)).toBeNull();
  });

  it('returns the most recent comment when multiple events exist', async () => {
    const order = await seedOrder();

    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: 'first comment' },
      status: 'delivered',
      createdAt: new Date(Date.now() - 10_000),
    });
    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: 'second comment' },
      status: 'delivered',
      createdAt: new Date(),
    });

    expect(await getChangesRequestedComment(order.id)).toBe('second comment');
  });
});

describe('getChangesRequestedCount', () => {
  it('is 0 initially and increments correctly, scoped by orderId+eventType', async () => {
    const order = await seedOrder();
    const otherOrder = await seedOrder({ orderNumber: 'OC-OTHER01' });

    expect(await getChangesRequestedCount(order.id)).toBe(0);

    await recordAuditEvent({
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: 'a' },
    });
    expect(await getChangesRequestedCount(order.id)).toBe(1);

    await recordAuditEvent({
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: 'b' },
    });
    expect(await getChangesRequestedCount(order.id)).toBe(2);

    // an unrelated event type on the same order should not count
    await recordAuditEvent({
      aggregateId: order.id,
      eventType: 'order.viewed',
      payload: {},
    });
    expect(await getChangesRequestedCount(order.id)).toBe(2);

    // events on a different order should not leak in
    await recordAuditEvent({
      aggregateId: otherOrder.id,
      eventType: 'order.changes_requested',
      payload: { comment: 'other' },
    });
    expect(await getChangesRequestedCount(order.id)).toBe(2);
    expect(await getChangesRequestedCount(otherOrder.id)).toBe(1);
  });
});

describe('getOrderAuditLog', () => {
  it('returns events newest-first, scoped to the order and aggregateType=order', async () => {
    const order = await seedOrder();
    const otherOrder = await seedOrder({ orderNumber: 'OC-OTHER02' });

    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.viewed',
      payload: {},
      status: 'delivered',
      createdAt: new Date(Date.now() - 20_000),
    });
    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.confirmed',
      payload: {},
      status: 'delivered',
      createdAt: new Date(Date.now() - 10_000),
    });
    // different aggregateType on the same aggregateId should not appear
    await db.insert(schema.domainEvents).values({
      aggregateType: 'garment',
      aggregateId: order.id,
      eventType: 'order.updated',
      payload: {},
      status: 'delivered',
    });
    // event on a different order should not leak in
    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: otherOrder.id,
      eventType: 'order.viewed',
      payload: {},
      status: 'delivered',
    });

    const log = await getOrderAuditLog(order.id);

    expect(log).toHaveLength(2);
    expect(log[0].eventType).toBe('order.confirmed');
    expect(log[1].eventType).toBe('order.viewed');
    expect(log.every((e) => e.aggregateType === 'order')).toBe(true);
    expect(log.every((e) => e.aggregateId === order.id)).toBe(true);
  });
});
