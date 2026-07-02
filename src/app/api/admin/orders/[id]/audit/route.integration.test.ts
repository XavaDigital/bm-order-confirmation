import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, generateAccessToken } from '@/server/orders/service';
import { recordAuditEvent } from '@/server/events/outbox';
import { GET } from './route';

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
