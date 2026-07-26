import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
import { getSession } from '@/lib/session';
import { createGarmentType } from '@/server/garment-types/service';
import { createGarmentTypeSchema } from '@/server/garment-types/contract';
import { GET, POST } from './route';
import { PATCH } from './[id]/route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession(role: 'sales' | 'admin') {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = role;
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

async function seedType(name = 'Hoodie', isActive = true) {
  return createGarmentType(
    createGarmentTypeSchema.parse({
      name,
      isActive,
      orderOptions: [{ label: 'Zip Type', options: ['full-zip', 'pullover'], defaultOption: 'pullover' }],
    }),
  );
}

describe('GET /api/admin/garment-types', () => {
  it('lists all types, and only active ones with ?active=1', async () => {
    await setSession('sales');
    await seedType('Hoodie', true);
    await seedType('Old Jacket', false);

    const all = await GET(jsonRequest('/api/admin/garment-types', 'GET'));
    const allJson = await all.json();
    expect(all.status).toBe(200);
    expect(allJson).toHaveLength(2);

    const active = await GET(jsonRequest('/api/admin/garment-types?active=1', 'GET'));
    const activeJson = await active.json();
    expect(activeJson).toHaveLength(1);
    expect(activeJson[0].name).toBe('Hoodie');
  });
});

describe('POST /api/admin/garment-types', () => {
  it('returns 401 when unauthenticated and 403 for the sales role', async () => {
    const unauthed = await POST(jsonRequest('/api/admin/garment-types', 'POST', { name: 'X' }));
    expect(unauthed.status).toBe(401);

    await setSession('sales');
    const sales = await POST(jsonRequest('/api/admin/garment-types', 'POST', { name: 'X' }));
    expect(sales.status).toBe(403);
  });

  it('creates a type for an admin and returns 201', async () => {
    await setSession('admin');
    const res = await POST(
      jsonRequest('/api/admin/garment-types', 'POST', {
        name: 'Hoodie',
        orderOptions: [{ label: 'Cord Color', type: 'text' }],
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.name).toBe('Hoodie');
    expect(json.orderOptions).toEqual([{ label: 'Cord Color', type: 'text' }]);
  });

  it('returns 400 for an invalid payload', async () => {
    await setSession('admin');
    const res = await POST(jsonRequest('/api/admin/garment-types', 'POST', { name: '' }));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/admin/garment-types/[id]', () => {
  it('is admin-only and deactivates instead of deleting', async () => {
    const type = await seedType();

    await setSession('sales');
    const salesRes = await PATCH(
      jsonRequest(`/api/admin/garment-types/${type.id}`, 'PATCH', { isActive: false }),
      { params: Promise.resolve({ id: type.id }) },
    );
    expect(salesRes.status).toBe(403);

    await setSession('admin');
    const res = await PATCH(
      jsonRequest(`/api/admin/garment-types/${type.id}`, 'PATCH', { isActive: false }),
      { params: Promise.resolve({ id: type.id }) },
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.isActive).toBe(false);
  });

  it('returns 404 for an unknown id', async () => {
    await setSession('admin');
    const res = await PATCH(
      jsonRequest('/api/admin/garment-types/00000000-0000-4000-8000-000000000000', 'PATCH', { name: 'Y' }),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});
