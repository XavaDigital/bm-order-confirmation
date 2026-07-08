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
import { createOrder, getOrderAdmin } from '@/server/orders/service';
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
    garments: [{ name: 'Home Jersey', sizing: [{ size: 'M' }] }],
    ...overrides,
  });
}

function postRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/duplicate', { method: 'POST' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/duplicate', () => {
  it('returns 404 for an unknown order id', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 201 with a new draft order id/number distinct from the source', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.orderId).not.toBe(created.orderId);
    expect(json.orderNumber).not.toBe(created.orderNumber);

    const dupOrder = await getOrderAdmin(json.orderId);
    expect(dupOrder!.status).toBe('draft');
    expect(dupOrder!.garments).toHaveLength(1);
    expect(dupOrder!.garments[0].sizing).toHaveLength(1);
  });

  it('records an order.duplicated audit event with the actor email', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    const events = await db.query.domainEvents.findMany({
      where: eq(schema.domainEvents.aggregateId, json.orderId),
    });
    const dupEvent = events.find((e) => e.eventType === 'order.duplicated');
    expect(dupEvent).toBeDefined();
    expect(dupEvent!.payload).toMatchObject({
      sourceOrderId: created.orderId,
      actorEmail: 'staff@example.com',
    });
  });
});
