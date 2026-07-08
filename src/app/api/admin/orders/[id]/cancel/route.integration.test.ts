import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/lib/session', () => {
  const store: Record<string, unknown> = {};
  const session = new Proxy(store, {
    get(target, prop) {
      if (prop === 'save') return async () => {};
      if (prop === 'destroy') return () => { for (const k of Object.keys(target)) delete target[k]; };
      return target[prop as string];
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
  return { getSession: vi.fn(async () => session) };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, generateAccessToken } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.email = 'staff@example.com';
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function postRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/cancel', { method: 'POST' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/cancel', () => {
  it('returns 404 for an unknown order id', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('cancels a sent order, revokes its token, and records the actor email', async () => {
    const created = await createOrder(minimalOrderInput());
    await generateAccessToken(created.orderId);

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.status).toBe('cancelled');

    const access = await db.query.orderAccess.findMany({
      where: eq(schema.orderAccess.orderId, created.orderId),
    });
    expect(access.every((a) => a.revokedAt !== null)).toBe(true);

    const events = await db.query.domainEvents.findMany({
      where: eq(schema.domainEvents.aggregateId, created.orderId),
    });
    const cancelEvent = events.find((e) => e.eventType === 'order.cancelled');
    expect(cancelEvent).toBeDefined();
    expect(cancelEvent!.payload).toMatchObject({ actorEmail: 'staff@example.com' });
  });

  it('returns 409 for an already-cancelled order', async () => {
    const created = await createOrder(minimalOrderInput());
    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    expect(res.status).toBe(409);
  });

  it('returns 409 for a confirmed order', async () => {
    const created = await createOrder(minimalOrderInput());
    await db.update(schema.orders).set({ status: 'confirmed' }).where(eq(schema.orders.id, created.orderId));

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    expect(res.status).toBe(409);
  });
});
