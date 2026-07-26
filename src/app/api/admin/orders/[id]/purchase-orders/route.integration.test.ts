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
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrder, upsertSizingRows } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createPurchaseOrder } from '@/server/purchase-orders/service';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setStaffSession() {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.email = 'sam@example.com';
  session.role = 'sales';
}

const request = (orderId: string) =>
  new NextRequest(`http://localhost/api/admin/orders/${orderId}/purchase-orders`, { method: 'GET' });
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/admin/orders/[id]/purchase-orders', () => {
  it('returns 401 without a session', async () => {
    const res = await GET(request('x'), withId('x'));
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown order', async () => {
    await setStaffSession();
    const ghost = '00000000-0000-4000-8000-000000000000';
    const res = await GET(request(ghost), withId(ghost));
    expect(res.status).toBe(404);
  });

  it('serves the production summary with coverage and variance', async () => {
    await setStaffSession();
    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: 'Vast Apparel', supplierCode: 'VA' })
      .returning();
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane Coach', email: 'jane@example.com' },
        garments: [
          { name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice' }, { size: 'L' }] },
        ],
      }),
    );
    const garment = (await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
      with: { sizing: { orderBy: (s, { asc }) => [asc(s.sortOrder)] } },
    }))!;
    const po = await createPurchaseOrder({
      orderId: created.orderId,
      supplierId: supplier.id,
      garmentIds: [garment.id],
    });

    const clean = await GET(request(created.orderId), withId(created.orderId));
    const cleanJson = await clean.json();
    expect(clean.status).toBe(200);
    expect(cleanJson.orderId).toBe(created.orderId);
    expect(cleanJson.coverage).toMatchObject({ totalRows: 2, coveredRows: 2, percentage: 100 });
    expect(cleanJson.purchaseOrders).toHaveLength(1);
    expect(cleanJson.purchaseOrders[0]).toMatchObject({
      poNumber: po.poNumber,
      varianceCounts: { added: 0, modified: 0, removed: 0 },
    });

    // Live edit after the snapshot → variance surfaces in the summary.
    await upsertSizingRows(
      garment.id,
      garment.sizing.map((row) => ({
        id: row.id,
        size: row.playerName === 'Alice' ? 'XL' : row.size,
        playerName: row.playerName,
        playerNumber: row.playerNumber,
        notes: row.notes,
      })),
    );
    const edited = await GET(request(created.orderId), withId(created.orderId));
    const editedJson = await edited.json();
    expect(editedJson.purchaseOrders[0].varianceCounts).toEqual({
      added: 0,
      modified: 1,
      removed: 0,
    });
    expect(editedJson.purchaseOrders[0].variance.hasVariance).toBe(true);
  });
});
