import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
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
import { addRosterMember } from '@/server/roster/service';
import { getSession } from '@/lib/session';
import { POST } from './route';

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
  return new NextRequest('http://localhost/api/admin/orders/x/roster/members/y/link', { method: 'POST' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/roster/members/[memberId]/link', () => {
  it('returns 201 with a token and individual roster url', async () => {
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });

    const res = await POST(postRequest(), {
      params: Promise.resolve({ id: created.orderId, memberId: member.id }),
    });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.token).toBeTruthy();
    expect(json.url).toContain('/o/roster/member/');
  });

  it('returns 404 for an unknown order', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: UNKNOWN_ID, memberId: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the member does not belong to the given order', async () => {
    const created = await createOrder(minimalOrderInput());
    const other = await createOrder(minimalOrderInput());
    const otherMember = await addRosterMember(other.orderId, { name: 'Sam' });

    const res = await POST(postRequest(), {
      params: Promise.resolve({ id: created.orderId, memberId: otherMember.id }),
    });

    expect(res.status).toBe(404);
  });

  it('regenerating revokes only the previous token for this member', async () => {
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId, memberId: member.id }) });

    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId, memberId: member.id }) });

    const active = await db.query.rosterMemberAccess.findMany({
      where: and(eq(schema.rosterMemberAccess.rosterMemberId, member.id), isNull(schema.rosterMemberAccess.revokedAt)),
    });
    expect(active).toHaveLength(1);
  });
});
