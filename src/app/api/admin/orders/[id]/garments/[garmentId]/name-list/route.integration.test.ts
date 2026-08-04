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
import { getSession } from '@/lib/session';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { POST as postNameList } from './route';
import { POST as postImportRoster } from './import-roster/route';

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
});

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Tribute Tee' }],
    ...overrides,
  });
}

async function seedOrderWithGarment() {
  const created = await createOrder(minimalOrderInput());
  const garment = await db.query.garments.findFirst({ where: eq(schema.garments.orderId, created.orderId) });
  return { orderId: created.orderId, garmentId: garment!.id };
}

function postRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/admin/orders/[id]/garments/[garmentId]/name-list', () => {
  it('returns 400 for an invalid body', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await postNameList(
      postRequest('http://localhost/api/admin/orders/x/garments/y/name-list', { not: 'an array' }),
      { params: Promise.resolve({ id: orderId, garmentId }) },
    );

    expect(res.status).toBe(400);
  });

  it('replaces the name-list entry set, never writing to garment_sizing', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();

    const res = await postNameList(
      postRequest('http://localhost/api/admin/orders/x/garments/y/name-list', [
        { name: 'Alex', playerNumber: '7' },
        { name: 'Sam' },
      ]),
      { params: Promise.resolve({ id: orderId, garmentId }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.entries).toHaveLength(2);

    const entries = await db.query.garmentNameListEntries.findMany({
      where: eq(schema.garmentNameListEntries.garmentId, garmentId),
    });
    expect(entries).toHaveLength(2);

    // The cardinality guarantee this table exists for (GOT_YOUR_BACK_PLAN.md):
    // names never become manufacture units.
    const sizingRows = await db
      .select()
      .from(schema.garmentSizing)
      .where(eq(schema.garmentSizing.garmentId, garmentId));
    expect(sizingRows).toHaveLength(0);
  });

  it('clears all entries when given an empty array', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();
    await postNameList(
      postRequest('http://localhost/api/admin/orders/x/garments/y/name-list', [{ name: 'Alex' }]),
      { params: Promise.resolve({ id: orderId, garmentId }) },
    );

    const res = await postNameList(
      postRequest('http://localhost/api/admin/orders/x/garments/y/name-list', []),
      { params: Promise.resolve({ id: orderId, garmentId }) },
    );

    expect(res.status).toBe(200);
    const entries = await db.query.garmentNameListEntries.findMany({
      where: eq(schema.garmentNameListEntries.garmentId, garmentId),
    });
    expect(entries).toHaveLength(0);
  });
});

describe('POST /api/admin/orders/[id]/garments/[garmentId]/name-list/import-roster', () => {
  it('imports roster member names not already on the list', async () => {
    const { orderId, garmentId } = await seedOrderWithGarment();
    await db.insert(schema.rosterMembers).values([
      { orderId, name: 'Alex', playerNumber: '7' },
      { orderId, name: 'Sam' },
    ]);

    const res = await postImportRoster(
      new NextRequest('http://localhost/api/admin/orders/x/garments/y/name-list/import-roster', { method: 'POST' }),
      { params: Promise.resolve({ id: orderId, garmentId }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.imported).toBe(2);
    expect(json.entries.map((e: { name: string }) => e.name).sort()).toEqual(['Alex', 'Sam']);
  });
});
