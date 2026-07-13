import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { POST, DELETE } from './route';

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
  return new NextRequest('http://localhost/api/admin/orders/x/roster/lock', { method: 'POST' });
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/roster/lock', { method: 'DELETE' });
}

describe('POST /api/admin/orders/[id]/roster/lock', () => {
  it('returns 404 for an unknown order', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) });
    expect(res.status).toBe(404);
  });

  it('returns 200 and sets rosterLockedAt', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.rosterLockedAt).not.toBeNull();
  });
});

describe('DELETE /api/admin/orders/[id]/roster/lock', () => {
  it('returns 200 and clears rosterLockedAt', async () => {
    const created = await createOrder(minimalOrderInput());
    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order!.rosterLockedAt).toBeNull();
  });
});
