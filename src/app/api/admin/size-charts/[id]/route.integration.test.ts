import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/mock'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { deleteFile } from '@/lib/storage';
import { PATCH, DELETE } from './route';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(deleteFile).mockClear();
});

async function seedChart(overrides: Partial<typeof schema.sizeCharts.$inferInsert> = {}) {
  const [chart] = await db
    .insert(schema.sizeCharts)
    .values({ name: 'Adult Unisex', storageKey: 'size-charts/a.pdf', ...overrides })
    .returning();
  return chart;
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/size-charts/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function patchRequestRaw(rawBody: string) {
  return new NextRequest('http://localhost/api/admin/size-charts/x', {
    method: 'PATCH',
    body: rawBody,
    headers: { 'content-type': 'application/json' },
  });
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/admin/size-charts/x', { method: 'DELETE' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('PATCH /api/admin/size-charts/[id]', () => {
  it('returns 400 with details for an invalid body', async () => {
    const chart = await seedChart();
    const res = await PATCH(patchRequest({ name: '' }), { params: Promise.resolve({ id: chart.id }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await PATCH(patchRequest({ name: 'New Name' }), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a request body that is not valid JSON', async () => {
    const chart = await seedChart();
    const res = await PATCH(patchRequestRaw('not-json{{'), { params: Promise.resolve({ id: chart.id }) });
    expect(res.status).toBe(400);
  });

  it('returns 200 with the updated chart and persists it', async () => {
    const chart = await seedChart();
    const res = await PATCH(patchRequest({ name: 'Youth Unisex', description: null }), {
      params: Promise.resolve({ id: chart.id }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.name).toBe('Youth Unisex');
    expect(json.description).toBeNull();

    const row = await db.query.sizeCharts.findFirst({ where: eq(schema.sizeCharts.id, chart.id) });
    expect(row!.name).toBe('Youth Unisex');
  });
});

describe('DELETE /api/admin/size-charts/[id]', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 200 with linkedGarmentCount=0 and removes the row when unlinked', async () => {
    const chart = await seedChart();
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: chart.id }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, linkedGarmentCount: 0 });

    const row = await db.query.sizeCharts.findFirst({ where: eq(schema.sizeCharts.id, chart.id) });
    expect(row).toBeUndefined();
    expect(deleteFile).toHaveBeenCalledWith('size-charts/a.pdf');
  });

  it('returns the correct linkedGarmentCount when garments reference the chart', async () => {
    const chart = await seedChart();
    const [order] = await db
      .insert(schema.orders)
      .values({ orderNumber: 'OC-TEST1', customerName: 'Jane', customerEmail: 'jane@example.com' })
      .returning();
    const [garment] = await db
      .insert(schema.garments)
      .values({ orderId: order.id, name: 'Jersey' })
      .returning();
    await db.insert(schema.garmentSizeChartLinks).values({ garmentId: garment.id, sizeChartId: chart.id });

    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: chart.id }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, linkedGarmentCount: 1 });
  });
});
