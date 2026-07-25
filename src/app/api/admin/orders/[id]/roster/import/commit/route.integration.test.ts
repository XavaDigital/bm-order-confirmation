import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
  session.email = 'staff@example.com';
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function csvFile(content: string) {
  return new File([content], 'roster.csv', { type: 'text/csv' });
}

function postRequest(orderId: string, formData: FormData) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/roster/import/commit`, {
    method: 'POST',
    body: formData,
  });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';
const MAPPING = JSON.stringify({ nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 });

describe('POST /api/admin/orders/[id]/roster/import/commit', () => {
  it('returns 400 when no file is provided', async () => {
    const created = await createOrder(minimalOrderInput());
    const fd = new FormData();
    fd.append('mapping', MAPPING);

    const res = await POST(postRequest(created.orderId, fd), { params: Promise.resolve({ id: created.orderId }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no mapping is provided', async () => {
    const created = await createOrder(minimalOrderInput());
    const fd = new FormData();
    fd.append('file', csvFile('Name\nAlex\n'));

    const res = await POST(postRequest(created.orderId, fd), { params: Promise.resolve({ id: created.orderId }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a malformed mapping shape', async () => {
    const created = await createOrder(minimalOrderInput());
    const fd = new FormData();
    fd.append('file', csvFile('Name\nAlex\n'));
    fd.append('mapping', JSON.stringify({ nameColumn: 'not-a-number' }));

    const res = await POST(postRequest(created.orderId, fd), { params: Promise.resolve({ id: created.orderId }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unparseable file', async () => {
    const created = await createOrder(minimalOrderInput());
    const fd = new FormData();
    fd.append('file', new File(['whatever'], 'roster.xls'));
    fd.append('mapping', MAPPING);

    const res = await POST(postRequest(created.orderId, fd), { params: Promise.resolve({ id: created.orderId }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown order', async () => {
    const fd = new FormData();
    fd.append('file', csvFile('Name,Number,Email\nAlex,7,alex@example.com\n'));
    fd.append('mapping', MAPPING);

    const res = await POST(postRequest(UNKNOWN_ID, fd), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 201, imports members, and persists them', async () => {
    const created = await createOrder(minimalOrderInput());
    const fd = new FormData();
    fd.append(
      'file',
      csvFile('Name,Number,Email\nAlex,7,alex@example.com\nSam,9,not-an-email\n'),
    );
    fd.append('mapping', MAPPING);

    const res = await POST(postRequest(created.orderId, fd), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.imported).toBe(2);
    expect(json.skippedBlank).toBe(0);
    expect(json.skippedDuplicate).toBe(0);

    const rows = await db.query.rosterMembers.findMany({ where: eq(schema.rosterMembers.orderId, created.orderId) });
    expect(rows.map((r) => r.name).sort()).toEqual(['Alex', 'Sam']);
  });
});
