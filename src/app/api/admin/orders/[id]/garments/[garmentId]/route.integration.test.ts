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

async function seedOrderWithGarment() {
  const created = await createOrder(minimalOrderInput());
  const garment = await db.query.garments.findFirst({ where: eq(schema.garments.orderId, created.orderId) });
  return { orderId: created.orderId, garmentId: garment!.id };
}

async function seedSizeChart(name = 'Adult Unisex') {
  const [row] = await db.insert(schema.sizeCharts).values({ name }).returning();
  return row;
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/orders/x/garments/y', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/garments/y', { method: 'DELETE' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('PATCH /api/admin/orders/[id]/garments/[garmentId]', () => {
  it('returns 400 with details for an invalid body', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await PATCH(patchRequest({ name: '' }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 404 for an unknown garment id', async () => {
    const { orderId } = await seedOrderWithGarment();

    const res = await PATCH(patchRequest({ name: 'Away Jersey' }), {
      params: Promise.resolve({ id: orderId, garmentId: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 200 { ok: true } and the DB reflects the patch', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await PATCH(patchRequest({ name: 'Away Jersey', notes: 'rush order' }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const row = await db.query.garments.findFirst({ where: eq(schema.garments.id, garmentId) });
    expect(row!.name).toBe('Away Jersey');
    expect(row!.notes).toBe('rush order');
  });

  it('replaces size-chart links when sizeChartIds is provided', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();
    const chartA = await seedSizeChart('Chart A');
    const chartB = await seedSizeChart('Chart B');

    const res = await PATCH(patchRequest({ sizeChartIds: [chartA.id, chartB.id] }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    expect(res.status).toBe(200);

    let links = await db.query.garmentSizeChartLinks.findMany({ where: eq(schema.garmentSizeChartLinks.garmentId, garmentId) });
    expect(links.map((l) => l.sizeChartId).sort()).toEqual([chartA.id, chartB.id].sort());

    const res2 = await PATCH(patchRequest({ sizeChartIds: [chartA.id] }), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    expect(res2.status).toBe(200);

    links = await db.query.garmentSizeChartLinks.findMany({ where: eq(schema.garmentSizeChartLinks.garmentId, garmentId) });
    expect(links.map((l) => l.sizeChartId)).toEqual([chartA.id]);
  });
});

describe('DELETE /api/admin/orders/[id]/garments/[garmentId]', () => {
  it('returns 404 for an unknown garment id', async () => {
    const { orderId } = await seedOrderWithGarment();

    const res = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: orderId, garmentId: UNKNOWN_ID }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 200 { ok: true } and removes the row', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: orderId, garmentId }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const row = await db.query.garments.findFirst({ where: eq(schema.garments.id, garmentId) });
    expect(row).toBeUndefined();
  });
});
