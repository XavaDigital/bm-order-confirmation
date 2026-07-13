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
import { addRosterMember, generateRosterToken } from '@/server/roster/service';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function postRequest(token: string, memberId: string, body: unknown, ip = '198.51.100.20') {
  return new NextRequest(`http://localhost/api/o/roster/${token}/members/${memberId}/sizes`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-real-ip': ip,
    },
  });
}

describe('POST /api/o/roster/[rosterToken]/members/[memberId]/sizes', () => {
  it('returns 400 for an invalid body', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const { token } = await generateRosterToken(created.orderId);

    const res = await POST(postRequest(token, member.id, { sizes: [] }), {
      params: Promise.resolve({ rosterToken: token, memberId: member.id }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 for an invalid token or cross-order member', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const other = await createOrder(minimalInput());
    const otherMember = await addRosterMember(other.orderId, { name: 'Sam' });
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const { token } = await generateRosterToken(created.orderId);

    const badToken = await POST(
      postRequest('bogus', member.id, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }, '198.51.100.21'),
      { params: Promise.resolve({ rosterToken: 'bogus', memberId: member.id }) },
    );
    expect(badToken.status).toBe(404);

    const crossOrder = await POST(
      postRequest(token, otherMember.id, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }, '198.51.100.22'),
      { params: Promise.resolve({ rosterToken: token, memberId: otherMember.id }) },
    );
    expect(crossOrder.status).toBe(404);
  });

  it('returns 200, saves sizes, and updates instead of duplicating on resubmit', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const { token } = await generateRosterToken(created.orderId);

    const first = await POST(
      postRequest(token, member.id, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }, '198.51.100.23'),
      { params: Promise.resolve({ rosterToken: token, memberId: member.id }) },
    );
    expect(first.status).toBe(200);

    const second = await POST(
      postRequest(token, member.id, { sizes: [{ garmentId: order!.garments[0].id, size: 'L' }] }, '198.51.100.24'),
      { params: Promise.resolve({ rosterToken: token, memberId: member.id }) },
    );
    const json = await second.json();

    expect(second.status).toBe(200);
    expect(json.sizes[0]).toEqual({ garmentId: order!.garments[0].id, size: 'L' });

    const rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.rosterMemberId, member.id),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].size).toBe('L');
  });

  it('returns 409 when the roster is locked', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const { token } = await generateRosterToken(created.orderId);
    await db
      .update(schema.orders)
      .set({ rosterLockedAt: new Date() })
      .where(eq(schema.orders.id, created.orderId));

    const res = await POST(
      postRequest(token, member.id, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }, '198.51.100.25'),
      { params: Promise.resolve({ rosterToken: token, memberId: member.id }) },
    );

    expect(res.status).toBe(409);
  });
});
