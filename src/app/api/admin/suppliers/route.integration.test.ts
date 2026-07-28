import type { StaffRole } from '@/lib/roles';
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
import { createSupplier } from '@/server/suppliers/service';
import { createSupplierSchema } from '@/server/suppliers/contract';
import { GET, POST } from './route';
import { GET as GET_ONE, PATCH } from './[id]/route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession(role: StaffRole) {
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

async function seedSupplier(name = 'Dongguan Apparel', code: string | undefined = 'DG', isActive = true) {
  return createSupplier(
    createSupplierSchema.parse({
      name,
      supplierCode: code,
      specialties: ['hoodies'],
      isActive,
    }),
  );
}

describe('GET /api/admin/suppliers', () => {
  it('requires a staff session', async () => {
    const res = await GET(jsonRequest('/api/admin/suppliers', 'GET'));
    expect(res.status).toBe(401);
  });

  it('lists all suppliers, and only active ones with ?active=1', async () => {
    await setSession('sales');
    await seedSupplier('Active Supplier', 'AS', true);
    await seedSupplier('Retired Supplier', 'RS', false);

    const all = await GET(jsonRequest('/api/admin/suppliers', 'GET'));
    const allJson = await all.json();
    expect(all.status).toBe(200);
    expect(allJson).toHaveLength(2);

    const active = await GET(jsonRequest('/api/admin/suppliers?active=1', 'GET'));
    const activeJson = await active.json();
    expect(activeJson).toHaveLength(1);
    expect(activeJson[0].name).toBe('Active Supplier');
  });
});

describe('POST /api/admin/suppliers', () => {
  it('returns 401 when unauthenticated and 403 for the sales role', async () => {
    const unauthed = await POST(jsonRequest('/api/admin/suppliers', 'POST', { name: 'X' }));
    expect(unauthed.status).toBe(401);

    await setSession('sales');
    const sales = await POST(jsonRequest('/api/admin/suppliers', 'POST', { name: 'X' }));
    expect(sales.status).toBe(403);
  });

  it('creates a supplier for an admin and returns 201', async () => {
    await setSession('admin');
    const res = await POST(
      jsonRequest('/api/admin/suppliers', 'POST', {
        name: 'Dongguan Apparel',
        supplierCode: 'dg',
        specialties: ['hoodies', 'jackets'],
        minimumOrderQuantity: 50,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.name).toBe('Dongguan Apparel');
    // Contract uppercases the code.
    expect(json.supplierCode).toBe('DG');
    expect(json.specialties).toEqual(['hoodies', 'jackets']);
    expect(json.isActive).toBe(true);
  });

  it('returns 400 for an invalid payload', async () => {
    await setSession('admin');
    const noName = await POST(jsonRequest('/api/admin/suppliers', 'POST', { name: '' }));
    expect(noName.status).toBe(400);

    const badCode = await POST(
      jsonRequest('/api/admin/suppliers', 'POST', { name: 'X Co', supplierCode: 'TOOLONG' }),
    );
    expect(badCode.status).toBe(400);
  });

  it('returns 409 for a duplicate supplier code', async () => {
    await setSession('admin');
    await seedSupplier('First', 'DG');
    const res = await POST(
      jsonRequest('/api/admin/suppliers', 'POST', { name: 'Second', supplierCode: 'DG' }),
    );
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error).toBe('Supplier code already in use');
  });
});

describe('GET /api/admin/suppliers/[id]', () => {
  it('returns a single supplier for staff', async () => {
    await setSession('sales');
    const supplier = await seedSupplier();
    const res = await GET_ONE(
      jsonRequest(`/api/admin/suppliers/${supplier.id}`, 'GET'),
      { params: Promise.resolve({ id: supplier.id }) },
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.id).toBe(supplier.id);
  });
});

describe('PATCH /api/admin/suppliers/[id]', () => {
  it('is admin-only and deactivates instead of deleting', async () => {
    const supplier = await seedSupplier();

    await setSession('sales');
    const salesRes = await PATCH(
      jsonRequest(`/api/admin/suppliers/${supplier.id}`, 'PATCH', { isActive: false }),
      { params: Promise.resolve({ id: supplier.id }) },
    );
    expect(salesRes.status).toBe(403);

    await setSession('admin');
    const res = await PATCH(
      jsonRequest(`/api/admin/suppliers/${supplier.id}`, 'PATCH', { isActive: false }),
      { params: Promise.resolve({ id: supplier.id }) },
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.isActive).toBe(false);
  });

  it('returns 404 for an unknown id', async () => {
    await setSession('admin');
    const res = await PATCH(
      jsonRequest('/api/admin/suppliers/00000000-0000-4000-8000-000000000000', 'PATCH', { name: 'Y' }),
      { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }) },
    );
    expect(res.status).toBe(404);
  });
});
