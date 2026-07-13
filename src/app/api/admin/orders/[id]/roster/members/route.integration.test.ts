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
import { POST } from './route';

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

function postRequest(orderId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/roster/members`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/roster/members', () => {
  it('returns 400 for an invalid body', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(created.orderId, { name: '' }), {
      params: Promise.resolve({ id: created.orderId }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown order', async () => {
    const res = await POST(postRequest(UNKNOWN_ID, { name: 'Alex' }), {
      params: Promise.resolve({ id: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 201 with the created member', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(
      postRequest(created.orderId, { name: 'Alex', playerNumber: '7', email: 'alex@example.com' }),
      { params: Promise.resolve({ id: created.orderId }) },
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.name).toBe('Alex');
    expect(json.playerNumber).toBe('7');
    expect(json.email).toBe('alex@example.com');
    expect(json.submittedAt).toBeNull();
  });
});
