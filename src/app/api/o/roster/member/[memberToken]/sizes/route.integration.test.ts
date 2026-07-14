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
import { addRosterMember, generateMemberToken } from '@/server/roster/service';
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

function postRequest(token: string, body: unknown, ip = '198.51.100.30') {
  return new NextRequest(`http://localhost/api/o/roster/member/${token}/sizes`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-real-ip': ip,
    },
  });
}

describe('POST /api/o/roster/member/[memberToken]/sizes', () => {
  it('returns 400 for an invalid body', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });
    const { token } = await generateMemberToken(member.id);

    const res = await POST(postRequest(token, { sizes: [] }), {
      params: Promise.resolve({ memberToken: token }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 for an invalid token', async () => {
    const res = await POST(postRequest('bogus', { sizes: [{ garmentId: 'g1', size: 'M' }] }, '198.51.100.31'), {
      params: Promise.resolve({ memberToken: 'bogus' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 200, saves sizes, and updates instead of duplicating on resubmit', async () => {
    const created = await createOrder(minimalInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex', playerNumber: '7' });
    const order = await db.query.orders.findFirst({
      where: eq(schema.orders.id, created.orderId),
      with: { garments: true },
    });
    const { token } = await generateMemberToken(member.id);

    const first = await POST(
      postRequest(token, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }, '198.51.100.32'),
      { params: Promise.resolve({ memberToken: token }) },
    );
    expect(first.status).toBe(200);

    const second = await POST(
      postRequest(token, { sizes: [{ garmentId: order!.garments[0].id, size: 'L' }] }, '198.51.100.33'),
      { params: Promise.resolve({ memberToken: token }) },
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
    const { token } = await generateMemberToken(member.id);
    await db
      .update(schema.orders)
      .set({ rosterLockedAt: new Date() })
      .where(eq(schema.orders.id, created.orderId));

    const res = await POST(
      postRequest(token, { sizes: [{ garmentId: order!.garments[0].id, size: 'M' }] }, '198.51.100.34'),
      { params: Promise.resolve({ memberToken: token }) },
    );

    expect(res.status).toBe(409);
  });

  it('returns 429 with a Retry-After header after 10 requests from the same IP', async () => {
    const ip = '198.51.100.97';

    for (let i = 0; i < 10; i++) {
      const res = await POST(
        postRequest('unknown-token', { sizes: [{ garmentId: 'g1', size: 'M' }] }, ip),
        { params: Promise.resolve({ memberToken: 'unknown-token' }) },
      );
      expect(res.status).toBe(404);
    }

    const eleventh = await POST(
      postRequest('unknown-token', { sizes: [{ garmentId: 'g1', size: 'M' }] }, ip),
      { params: Promise.resolve({ memberToken: 'unknown-token' }) },
    );

    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get('Retry-After')).toBeTruthy();
  });
});
