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
import { createOrder } from '@/server/orders/service';
import { addRosterMember } from '@/server/roster/service';
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

function getRequest(orderId: string) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/roster`, { method: 'GET' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('GET /api/admin/orders/[id]/roster', () => {
  it('returns 404 for an unknown order', async () => {
    const res = await GET(getRequest(UNKNOWN_ID), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns an empty, unlocked roster for an order with no members', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await GET(getRequest(created.orderId), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.members).toEqual([]);
    expect(json.stats).toEqual({ total: 0, submitted: 0 });
    expect(json.currentAccess).toBeNull();
    expect(json.locked).toBe(false);
  });

  it('returns members for the order', async () => {
    const created = await createOrder(minimalOrderInput());
    await addRosterMember(created.orderId, { name: 'Alex' });

    const res = await GET(getRequest(created.orderId), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.members).toHaveLength(1);
    expect(json.members[0].name).toBe('Alex');
  });
});
