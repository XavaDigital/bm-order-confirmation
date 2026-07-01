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
import { createOrder, updateOrder } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { GET, PATCH, DELETE } from './route';

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

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/orders/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('PATCH /api/admin/orders/[id]', () => {
  it('returns 400 with details for an invalid body', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await PATCH(patchRequest({ orderValueAmount: 'not-a-number' }), {
      params: Promise.resolve({ id: created.orderId }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await PATCH(patchRequest({ clubName: 'New Club' }), {
      params: Promise.resolve({ id: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 200 { ok: true } and the DB reflects the patch', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await PATCH(patchRequest({ clubName: 'New Club' }), {
      params: Promise.resolve({ id: created.orderId }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const row = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(row!.clubName).toBe('New Club');
  });
});

describe('DELETE /api/admin/orders/[id]', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/admin/orders/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 409 for a non-draft order', async () => {
    const created = await createOrder(minimalOrderInput());
    await updateOrder(created.orderId, { status: 'sent' });

    const res = await DELETE(new NextRequest('http://localhost/api/admin/orders/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: created.orderId }),
    });

    expect(res.status).toBe(409);
  });

  it('returns 200 { ok: true } for a draft order and removes the row', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await DELETE(new NextRequest('http://localhost/api/admin/orders/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: created.orderId }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const row = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(row).toBeUndefined();
  });
});

describe('GET /api/admin/orders/[id]', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await GET(new NextRequest('http://localhost/api/admin/orders/x'), {
      params: Promise.resolve({ id: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 200 with the full nested admin shape for an existing order', async () => {
    const created = await createOrder(
      minimalOrderInput({
        garments: [{ name: 'Home Jersey', sizing: [{ size: 'M' }], mockupStorageKeys: ['a.png'] }],
      }),
    );

    const res = await GET(new NextRequest('http://localhost/api/admin/orders/x'), {
      params: Promise.resolve({ id: created.orderId }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe(created.orderId);
    expect(json.garments).toHaveLength(1);
    expect(json.garments[0].sizing).toHaveLength(1);
    expect(json.garments[0].images).toHaveLength(1);
    expect(json.currentAccess).toBeDefined();
  });
});
