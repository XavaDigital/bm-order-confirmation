import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
  return { getSession: vi.fn(async () => session) };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createPurchaseOrder, issueRevision } from '@/server/purchase-orders/service';
import { getSession } from '@/lib/session';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession() {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
  session.email = 'staff@example.com';
}

async function seedPo() {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: 'Vast Apparel', supplierCode: 'VA', email: 'factory@example.com' })
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
  }))!;
  const po = await createPurchaseOrder({
    orderId: created.orderId,
    supplierId: supplier.id,
    garmentIds: [garment.id],
  });
  return { po, orderId: created.orderId };
}

function getRequest(id: string, query = '') {
  return new NextRequest(`http://localhost/api/admin/purchase-orders/${id}/pdf${query}`);
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('GET /api/admin/purchase-orders/[id]/pdf', () => {
  it('returns 401 when there is no session', async () => {
    const { po } = await seedPo();

    const res = await GET(getRequest(po.id), withId(po.id));

    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown purchase order id', async () => {
    await setSession();

    const res = await GET(getRequest(UNKNOWN_ID), withId(UNKNOWN_ID));

    expect(res.status).toBe(404);
  });

  it('renders the latest revision by default with a PDF content-type and PO filename', async () => {
    await setSession();
    const { po } = await seedPo();

    const res = await GET(getRequest(po.id), withId(po.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${po.poNumber}.pdf"`,
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('defaults to the newest revision and adds -revN to the filename when N > 1', async () => {
    await setSession();
    const { po } = await seedPo();
    await issueRevision(po.id, { reason: 'sizes corrected' });

    const res = await GET(getRequest(po.id), withId(po.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${po.poNumber}-rev2.pdf"`,
    );
  });

  it('renders a specific historical revision via ?rev=n', async () => {
    await setSession();
    const { po } = await seedPo();
    await issueRevision(po.id, { reason: 'sizes corrected' });

    const res = await GET(getRequest(po.id, '?rev=1'), withId(po.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    // rev 1 keeps the plain filename
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${po.poNumber}.pdf"`,
    );
  });

  it('returns 404 for a missing or malformed ?rev', async () => {
    await setSession();
    const { po } = await seedPo();

    expect((await GET(getRequest(po.id, '?rev=99'), withId(po.id))).status).toBe(404);
    expect((await GET(getRequest(po.id, '?rev=abc'), withId(po.id))).status).toBe(404);
  });
});
