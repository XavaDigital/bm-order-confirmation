import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { GET } from './route';

const API_KEY = 'test-internal-api-key-0123456789';

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

function getRequest(id: string, apiKey?: string) {
  return new Request(`http://localhost/api/orders/${id}`, {
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('GET /api/orders/[id]', () => {
  it('returns 401 with a missing x-api-key', async () => {
    const created = await createOrder(minimalOrderInput());
    const res = await GET(getRequest(created.orderId), { params: Promise.resolve({ id: created.orderId }) });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a wrong x-api-key', async () => {
    const created = await createOrder(minimalOrderInput());
    const res = await GET(getRequest(created.orderId, 'wrong-key'), {
      params: Promise.resolve({ id: created.orderId }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown order id', async () => {
    const res = await GET(getRequest(UNKNOWN_ID, API_KEY), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 200 with the order for a valid key and id', async () => {
    const created = await createOrder(minimalOrderInput());
    const res = await GET(getRequest(created.orderId, API_KEY), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.order.id).toBe(created.orderId);
    expect(json.order.orderNumber).toBe(created.orderNumber);
  });

  it('never returns another order when given a different order id', async () => {
    const orderA = await createOrder(minimalOrderInput());
    const orderB = await createOrder(minimalOrderInput({ customer: { name: 'Bob', email: 'bob@example.com' } }));

    const res = await GET(getRequest(orderA.orderId, API_KEY), { params: Promise.resolve({ id: orderA.orderId }) });
    const json = await res.json();

    expect(json.order.id).toBe(orderA.orderId);
    expect(json.order.id).not.toBe(orderB.orderId);
  });
});
