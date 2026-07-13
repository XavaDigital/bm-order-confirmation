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
import { createOrder } from '@/server/orders/service';
import { addRosterMember } from '@/server/roster/service';
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
