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
import { generateRosterToken } from '@/server/roster/service';
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

function postRequest(token: string, body: unknown, ip = '198.51.100.10') {
  return new NextRequest(`http://localhost/api/o/roster/${token}/members`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-real-ip': ip,
    },
  });
}

describe('POST /api/o/roster/[rosterToken]/members', () => {
  it('returns 400 for an invalid body', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateRosterToken(created.orderId);

    const res = await POST(postRequest(token, { name: '' }), {
      params: Promise.resolve({ rosterToken: token }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 for an invalid token', async () => {
    const res = await POST(postRequest('bogus', { name: 'Alex' }, '198.51.100.11'), {
      params: Promise.resolve({ rosterToken: 'bogus' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 201 and creates the member', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateRosterToken(created.orderId);

    const res = await POST(
      postRequest(token, { name: 'Alex', playerNumber: '7', email: 'alex@example.com' }, '198.51.100.12'),
      { params: Promise.resolve({ rosterToken: token }) },
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.name).toBe('Alex');
    expect(json.playerNumber).toBe('7');
    expect(json.sizes).toEqual([]);

    const members = await db.query.rosterMembers.findMany({
      where: eq(schema.rosterMembers.orderId, created.orderId),
    });
    expect(members).toHaveLength(1);
  });

  it('returns 409 when the roster is locked', async () => {
    const created = await createOrder(minimalInput());
    const { token } = await generateRosterToken(created.orderId);
    await db
      .update(schema.orders)
      .set({ rosterLockedAt: new Date() })
      .where(eq(schema.orders.id, created.orderId));

    const res = await POST(postRequest(token, { name: 'Alex' }, '198.51.100.13'), {
      params: Promise.resolve({ rosterToken: token }),
    });

    expect(res.status).toBe(409);
  });

  it('returns 429 with a Retry-After header after 10 requests from the same IP', async () => {
    const ip = '198.51.100.99';

    for (let i = 0; i < 10; i++) {
      const res = await POST(postRequest('unknown-token', { name: 'Alex' }, ip), {
        params: Promise.resolve({ rosterToken: 'unknown-token' }),
      });
      expect(res.status).toBe(404);
    }

    const eleventh = await POST(postRequest('unknown-token', { name: 'Alex' }, ip), {
      params: Promise.resolve({ rosterToken: 'unknown-token' }),
    });

    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get('Retry-After')).toBeTruthy();
  });
});
