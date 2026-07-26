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
  emitOrderEvent,
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

describe('emitOrderEvent', () => {
  it('inserts a domain_events row inside a transaction', async () => {
    const order = await seedOrder();

    await db.transaction(async (tx) => {
      await emitOrderEvent(tx, {
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
        await emitOrderEvent(tx, {
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
  it('writes to audit_events (not the outbox) with the actor as a column', async () => {
    const order = await seedOrder();

    await recordAuditEvent({
      aggregateId: order.id,
      eventType: 'token.generated',
      payload: {},
      actorEmail: 'staff@example.com',
    });

    // Nothing lands in the outbox — audit rows have no delivery lifecycle.
    const outboxRows = await db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.aggregateId, order.id));
    expect(outboxRows).toHaveLength(0);

    const auditRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, order.id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].eventType).toBe('token.generated');
    expect(auditRows[0].actorEmail).toBe('staff@example.com');
  });

  it('accepts a transaction so the audit row commits atomically with the change', async () => {
    const order = await seedOrder();

    await expect(
      db.transaction(async (tx) => {
        await recordAuditEvent(
          { aggregateId: order.id, eventType: 'order.updated', payload: {} },
          tx,
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const auditRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, order.id));
    expect(auditRows).toHaveLength(0);
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

    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: 'a' },
      status: 'delivered',
    });
    expect(await getChangesRequestedCount(order.id)).toBe(1);

    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.changes_requested',
      payload: { comment: 'b' },
      status: 'delivered',
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
    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: otherOrder.id,
      eventType: 'order.changes_requested',
      payload: { comment: 'other' },
      status: 'delivered',
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
    await db.insert(schema.auditEvents).values({
      aggregateType: 'staff_user',
      aggregateId: order.id,
      eventType: 'staff.password_reset_requested',
      payload: {},
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
    // getOrderAuditLog now returns a merged projection without aggregate
    // columns — scoping is verified by the length + type assertions above.
  });

  it('merges audit_events rows into the order audit log, newest first', async () => {
    const order = await seedOrder();

    await db.insert(schema.domainEvents).values({
      aggregateType: 'order',
      aggregateId: order.id,
      eventType: 'order.viewed',
      payload: {},
      status: 'delivered',
      createdAt: new Date(Date.now() - 10_000),
    });
    await recordAuditEvent({
      aggregateId: order.id,
      eventType: 'order.updated',
      payload: { fields: ['customerName'] },
      actorEmail: 'staff@example.com',
    });

    const log = await getOrderAuditLog(order.id);

    expect(log.map((e) => e.eventType)).toEqual(['order.updated', 'order.viewed']);

    const auditRow = await db.query.auditEvents.findFirst({
      where: eq(schema.auditEvents.aggregateId, order.id),
    });
    expect(auditRow!.actorEmail).toBe('staff@example.com');
  });
});
