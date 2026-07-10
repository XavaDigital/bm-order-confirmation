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
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey', sizing: [{ size: 'S' }] }],
    ...overrides,
  });
}

async function seedOrderWithGarment() {
  const created = await createOrder(minimalOrderInput());
  const garment = await db.query.garments.findFirst({ where: eq(schema.garments.orderId, created.orderId) });
  return { orderId: created.orderId, garmentId: garment!.id };
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/orders/x/garments/y/sizing', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function postRequestRaw(rawBody: string) {
  return new NextRequest('http://localhost/api/admin/orders/x/garments/y/sizing', {
    method: 'POST',
    body: rawBody,
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/admin/orders/[id]/garments/[garmentId]/sizing', () => {
  it('returns 400 with details for an invalid body', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await POST(postRequest({ not: 'an array' }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 400 for a request body that is not valid JSON', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await POST(postRequestRaw('not-json{{'), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });

    expect(res.status).toBe(400);
  });

  it('replaces existing sizing rows with the new set', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await POST(
      postRequest([
        { size: 'M', playerName: 'Alice', playerNumber: '7' },
        { size: 'L', playerName: 'Bob', playerNumber: '9' },
      ]),
      { params: Promise.resolve({ id: orderId, garmentId }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const rows = await db.query.garmentSizing.findMany({
      where: eq(schema.garmentSizing.garmentId, garmentId),
      orderBy: (s, { asc }) => [asc(s.sortOrder)],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].size).toBe('M');
    expect(rows[1].size).toBe('L');
  });

  it('clears all sizing rows when given an empty array', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await POST(postRequest([]), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });

    expect(res.status).toBe(200);

    const rows = await db.query.garmentSizing.findMany({ where: eq(schema.garmentSizing.garmentId, garmentId) });
    expect(rows).toHaveLength(0);
  });
});
