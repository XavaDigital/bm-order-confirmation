import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

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
  return {
    getSession: vi.fn(async () => session),
    requireAdmin: vi.fn(async () => {
      if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { deleteFile } from '@/lib/storage';
import { getSession } from '@/lib/session';
import { PATCH, DELETE } from './route';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(deleteFile).mockClear();
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession(role: 'sales' | 'admin') {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.email = 'staff@example.com';
  session.name = 'Staff One';
  session.role = role;
}

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
  it('returns 401 when there is no session', async () => {
    const chart = await seedChart();
    const res = await PATCH(patchRequest({ name: 'New Name' }), { params: Promise.resolve({ id: chart.id }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a sales-role session', async () => {
    await setSession('sales');
    const chart = await seedChart();
    const res = await PATCH(patchRequest({ name: 'New Name' }), { params: Promise.resolve({ id: chart.id }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 with details for an invalid body', async () => {
    await setSession('admin');
    const chart = await seedChart();
    const res = await PATCH(patchRequest({ name: '' }), { params: Promise.resolve({ id: chart.id }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 404 for an unknown id', async () => {
    await setSession('admin');
    const res = await PATCH(patchRequest({ name: 'New Name' }), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a request body that is not valid JSON', async () => {
    await setSession('admin');
    const chart = await seedChart();
    const res = await PATCH(patchRequestRaw('not-json{{'), { params: Promise.resolve({ id: chart.id }) });
    expect(res.status).toBe(400);
  });

  it('returns 200 with the updated chart and persists it', async () => {
    await setSession('admin');
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
  it('returns 401 when there is no session', async () => {
    const chart = await seedChart();
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: chart.id }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a sales-role session', async () => {
    await setSession('sales');
    const chart = await seedChart();
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: chart.id }) });
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown id', async () => {
    await setSession('admin');
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 200 with linkedGarmentCount=0 and removes the row when unlinked', async () => {
    await setSession('admin');
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
    await setSession('admin');
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
