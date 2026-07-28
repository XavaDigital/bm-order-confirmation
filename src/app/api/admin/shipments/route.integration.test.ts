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
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createSupplier } from '@/server/suppliers/service';
import { createSupplierSchema } from '@/server/suppliers/contract';
import { createPurchaseOrder } from '@/server/purchase-orders/service';
import { eq } from 'drizzle-orm';
import { GET, POST } from './route';
import { GET as GET_ONE, PATCH } from './[id]/route';
import { POST as POST_STATUS } from './[id]/status/route';
import { POST as POST_ATTACH, DELETE as DELETE_DETACH } from './[id]/purchase-orders/route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession(role: StaffRole) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  // Routes stamp createdBy from the session — must be a real staff row.
  const [user] = await db
    .insert(schema.staffUsers)
    .values({ email: `${role}@example.com`, passwordHash: 'x', name: 'Staff', role })
    .onConflictDoNothing()
    .returning();
  const existing =
    user ??
    (await db.query.staffUsers.findFirst({
      where: eq(schema.staffUsers.email, `${role}@example.com`),
    }))!;
  session.userId = existing.id;
  session.email = existing.email;
  session.role = role;
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedSupplierAndPo() {
  const supplier = await createSupplier(
    createSupplierSchema.parse({ name: 'Vast Apparel', supplierCode: 'VA' }),
  );
  const order = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice' }] }],
    }),
  );
  const garment = await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, order.orderId),
  });
  const po = await createPurchaseOrder({
    orderId: order.orderId,
    supplierId: supplier.id,
    garmentIds: [garment!.id],
  });
  return { supplier, po };
}

describe('POST /api/admin/shipments', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await POST(jsonRequest('/api/admin/shipments', 'POST', {}));
    expect(res.status).toBe(401);
  });

  it('creates a shipment for any staff role (sales included) and returns 201', async () => {
    const { supplier, po } = await seedSupplierAndPo();
    await setSession('sales');

    const res = await POST(
      jsonRequest('/api/admin/shipments', 'POST', {
        supplierId: supplier.id,
        purchaseOrderIds: [po.id],
        nickname: 'July air freight',
        carrier: 'DHL',
        boxCount: 2,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.nickname).toBe('July air freight');
    expect(json.status).toBe('pending');
    expect(json.shippingCostCurrency).toBe('USD');
    expect(json.purchaseOrders.map((p: { id: string }) => p.id)).toEqual([po.id]);
  });

  it('returns 400 for an invalid payload and 409 for a cross-supplier PO', async () => {
    const { po } = await seedSupplierAndPo();
    const other = await createSupplier(
      createSupplierSchema.parse({ name: 'Northwind Textiles', supplierCode: 'NW' }),
    );
    await setSession('sales');

    const invalid = await POST(
      jsonRequest('/api/admin/shipments', 'POST', { supplierId: 'nope', purchaseOrderIds: [] }),
    );
    expect(invalid.status).toBe(400);

    const conflict = await POST(
      jsonRequest('/api/admin/shipments', 'POST', {
        supplierId: other.id,
        purchaseOrderIds: [po.id],
      }),
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toBe(
      `Purchase order ${po.poNumber} belongs to a different supplier`,
    );
  });
});

describe('GET /api/admin/shipments', () => {
  it('lists shipments with supplier name + PO numbers and honors the status filter', async () => {
    const { supplier, po } = await seedSupplierAndPo();
    await setSession('sales');

    const created = await POST(
      jsonRequest('/api/admin/shipments', 'POST', {
        supplierId: supplier.id,
        purchaseOrderIds: [po.id],
      }),
    );
    const shipment = await created.json();

    const all = await GET(jsonRequest('/api/admin/shipments', 'GET'));
    const allJson = await all.json();
    expect(all.status).toBe(200);
    expect(allJson).toHaveLength(1);
    expect(allJson[0]).toMatchObject({
      id: shipment.id,
      supplierName: 'Vast Apparel',
      poCount: 1,
      poNumbers: [po.poNumber],
    });

    const none = await GET(jsonRequest('/api/admin/shipments?status=delivered', 'GET'));
    expect(await none.json()).toHaveLength(0);
  });
});

describe('GET/PATCH /api/admin/shipments/[id]', () => {
  it('returns the shipment, patches fields, and 404s on unknown ids', async () => {
    const { supplier, po } = await seedSupplierAndPo();
    await setSession('sales');
    const created = await POST(
      jsonRequest('/api/admin/shipments', 'POST', {
        supplierId: supplier.id,
        purchaseOrderIds: [po.id],
        carrier: 'DHL',
      }),
    );
    const shipment = await created.json();

    const got = await GET_ONE(
      jsonRequest(`/api/admin/shipments/${shipment.id}`, 'GET'),
      params(shipment.id),
    );
    expect(got.status).toBe(200);
    expect((await got.json()).supplier.name).toBe('Vast Apparel');

    const patched = await PATCH(
      jsonRequest(`/api/admin/shipments/${shipment.id}`, 'PATCH', { carrier: null, boxCount: 5 }),
      params(shipment.id),
    );
    const patchedJson = await patched.json();
    expect(patched.status).toBe(200);
    expect(patchedJson.carrier).toBeNull();
    expect(patchedJson.boxCount).toBe(5);

    const ghost = '00000000-0000-4000-8000-000000000000';
    const missing = await GET_ONE(jsonRequest(`/api/admin/shipments/${ghost}`, 'GET'), params(ghost));
    expect(missing.status).toBe(404);
  });
});

describe('POST /api/admin/shipments/[id]/status', () => {
  it('applies legal transitions and returns a 409 body for illegal ones', async () => {
    const { supplier, po } = await seedSupplierAndPo();
    await setSession('sales');
    const created = await POST(
      jsonRequest('/api/admin/shipments', 'POST', {
        supplierId: supplier.id,
        purchaseOrderIds: [po.id],
      }),
    );
    const shipment = await created.json();

    const ok = await POST_STATUS(
      jsonRequest(`/api/admin/shipments/${shipment.id}/status`, 'POST', { status: 'in_transit' }),
      params(shipment.id),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe('in_transit');

    const illegal = await POST_STATUS(
      jsonRequest(`/api/admin/shipments/${shipment.id}/status`, 'POST', { status: 'cancelled' }),
      params(shipment.id),
    );
    expect(illegal.status).toBe(409);
    expect(await illegal.json()).toEqual({
      error: 'Cannot move a in_transit shipment to cancelled',
    });
  });
});

describe('POST/DELETE /api/admin/shipments/[id]/purchase-orders', () => {
  it('attaches and detaches POs, 409ing on duplicates', async () => {
    const { supplier, po } = await seedSupplierAndPo();
    await setSession('sales');
    const created = await POST(
      jsonRequest('/api/admin/shipments', 'POST', {
        supplierId: supplier.id,
        purchaseOrderIds: [po.id],
      }),
    );
    const shipment = await created.json();

    const dupe = await POST_ATTACH(
      jsonRequest(`/api/admin/shipments/${shipment.id}/purchase-orders`, 'POST', {
        purchaseOrderIds: [po.id],
      }),
      params(shipment.id),
    );
    expect(dupe.status).toBe(409);
    expect((await dupe.json()).error).toBe('Purchase order is already attached');

    const detached = await DELETE_DETACH(
      jsonRequest(`/api/admin/shipments/${shipment.id}/purchase-orders`, 'DELETE', {
        purchaseOrderId: po.id,
      }),
      params(shipment.id),
    );
    expect(detached.status).toBe(200);
    expect((await detached.json()).purchaseOrders).toHaveLength(0);

    const reattached = await POST_ATTACH(
      jsonRequest(`/api/admin/shipments/${shipment.id}/purchase-orders`, 'POST', {
        purchaseOrderIds: [po.id],
      }),
      params(shipment.id),
    );
    expect(reattached.status).toBe(200);
    expect((await reattached.json()).purchaseOrders.map((p: { id: string }) => p.id)).toEqual([
      po.id,
    ]);
  });
});
