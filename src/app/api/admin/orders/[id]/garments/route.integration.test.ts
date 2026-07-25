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
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { POST } from './route';

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
});

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function postRequest(orderId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/garments`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function postRequestRaw(orderId: string, rawBody: string) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/garments`, {
    method: 'POST',
    body: rawBody,
    headers: { 'content-type': 'application/json' },
  });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/garments', () => {
  it('returns 400 with details for an invalid body', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(created.orderId, { name: '' }), {
      params: Promise.resolve({ id: created.orderId }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 400 for a request body that is not valid JSON', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequestRaw(created.orderId, 'not-json{{'), {
      params: Promise.resolve({ id: created.orderId }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 500 when the order does not exist (FK violation)', async () => {
    const res = await POST(postRequest(UNKNOWN_ID, { name: 'Away Jersey' }), {
      params: Promise.resolve({ id: UNKNOWN_ID }),
    });

    expect(res.status).toBe(500);
  });

  it('returns 201 with the created garment and persists it', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(created.orderId, { name: 'Away Jersey', fabrics: ['polyester'] }), {
      params: Promise.resolve({ id: created.orderId }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.name).toBe('Away Jersey');
    expect(json.orderId).toBe(created.orderId);

    const rows = await db.select().from(schema.garments);
    const garmentRows = rows.filter((g) => g.orderId === created.orderId);
    expect(garmentRows).toHaveLength(2); // the seeded "Home Jersey" + this one
  });

  it('appends new garments after existing ones by sortOrder', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(created.orderId, { name: 'Away Jersey' }), {
      params: Promise.resolve({ id: created.orderId }),
    });
    const json = await res.json();

    expect(json.sortOrder).toBe(1);
  });
});
