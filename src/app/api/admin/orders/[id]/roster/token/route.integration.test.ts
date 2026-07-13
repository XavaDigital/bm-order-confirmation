import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, and, isNull } from 'drizzle-orm';
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
  return new NextRequest('http://localhost/api/admin/orders/x/roster/token', { method: 'POST' });
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/roster/token', { method: 'DELETE' });
}

describe('POST /api/admin/orders/[id]/roster/token', () => {
  it('returns 201 with a token and roster url', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.token).toBeTruthy();
    expect(json.url).toContain('/o/roster/');
  });

  it('regenerating revokes the previous roster token but leaves order_access untouched', async () => {
    const created = await createOrder(minimalOrderInput());
    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    expect(res.status).toBe(201);

    const activeRosterAccess = await db.query.rosterAccess.findMany({
      where: and(eq(schema.rosterAccess.orderId, created.orderId), isNull(schema.rosterAccess.revokedAt)),
    });
    expect(activeRosterAccess).toHaveLength(1);

    const activeOrderAccess = await db.query.orderAccess.findMany({
      where: and(eq(schema.orderAccess.orderId, created.orderId), isNull(schema.orderAccess.revokedAt)),
    });
    expect(activeOrderAccess).toHaveLength(1);
  });

  it('returns 404 for an order that does not exist', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/orders/[id]/roster/token', () => {
  it('returns 200 and revokes the active roster token', async () => {
    const created = await createOrder(minimalOrderInput());
    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const activeRosterAccess = await db.query.rosterAccess.findMany({
      where: and(eq(schema.rosterAccess.orderId, created.orderId), isNull(schema.rosterAccess.revokedAt)),
    });
    expect(activeRosterAccess).toHaveLength(0);
  });

  it('returns 200 even when there is no active roster token to revoke', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(200);
  });
});
