import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { addRosterMember } from '@/server/roster/service';
import { PATCH, DELETE } from './route';

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

function patchRequest(orderId: string, memberId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/roster/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function deleteRequest(orderId: string, memberId: string) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/roster/members/${memberId}`, {
    method: 'DELETE',
  });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('PATCH /api/admin/orders/[id]/roster/members/[memberId]', () => {
  it('returns 400 for an invalid body', async () => {
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });

    const res = await PATCH(patchRequest(created.orderId, member.id, { name: '' }), {
      params: Promise.resolve({ id: created.orderId, memberId: member.id }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown member', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await PATCH(patchRequest(created.orderId, UNKNOWN_ID, { name: 'New Name' }), {
      params: Promise.resolve({ id: created.orderId, memberId: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 200 and persists the patch', async () => {
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });

    const res = await PATCH(patchRequest(created.orderId, member.id, { playerNumber: '9' }), {
      params: Promise.resolve({ id: created.orderId, memberId: member.id }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const updated = await db.query.rosterMembers.findFirst({ where: eq(schema.rosterMembers.id, member.id) });
    expect(updated!.playerNumber).toBe('9');
  });
});

describe('DELETE /api/admin/orders/[id]/roster/members/[memberId]', () => {
  it('returns 404 for an unknown member', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await DELETE(deleteRequest(created.orderId, UNKNOWN_ID), {
      params: Promise.resolve({ id: created.orderId, memberId: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 200 and removes the member', async () => {
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });

    const res = await DELETE(deleteRequest(created.orderId, member.id), {
      params: Promise.resolve({ id: created.orderId, memberId: member.id }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const found = await db.query.rosterMembers.findFirst({ where: eq(schema.rosterMembers.id, member.id) });
    expect(found).toBeUndefined();
  });
});
