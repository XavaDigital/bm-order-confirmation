import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
  return {
    getSession: vi.fn(async () => session),
    requireAdmin: vi.fn(async () => {
      if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, generateAccessToken } from '@/server/orders/service';
import { recordAuditEvent } from '@/server/events/outbox';
import { getSession } from '@/lib/session';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
  session.email = 'staff@example.com';
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function getRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/audit');
}

describe('GET /api/admin/orders/[id]/audit', () => {
  it('returns an empty events array for an order with no audit history', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await GET(getRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.events).toEqual([]);
  });

  it('returns recorded events newest first', async () => {
    const created = await createOrder(minimalOrderInput());
    await recordAuditEvent({ aggregateId: created.orderId, eventType: 'order.updated', payload: { fields: ['clubName'] } });
    await generateAccessToken(created.orderId, { actorEmail: 'staff@example.com' });

    const res = await GET(getRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.events).toHaveLength(2);
    expect(json.events[0].eventType).toBe('token.generated');
    expect(json.events[1].eventType).toBe('order.updated');
  });

  it('does not include events from other orders', async () => {
    const orderA = await createOrder(minimalOrderInput());
    const orderB = await createOrder(minimalOrderInput({ customer: { name: 'Bob', email: 'bob@example.com' } }));
    await recordAuditEvent({ aggregateId: orderB.orderId, eventType: 'order.updated', payload: {} });

    const res = await GET(getRequest(), { params: Promise.resolve({ id: orderA.orderId }) });
    const json = await res.json();

    expect(json.events).toEqual([]);
  });
});
