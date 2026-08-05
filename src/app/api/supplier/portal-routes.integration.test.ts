/**
 * Route-level tests for the password-gated supplier portal
 * (/api/supplier/[code]/*). Lives beside the [code] directory rather than
 * inside it — same convention as the capability tests — so the bracket segment
 * never meets a test glob.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { buildSupplierSessionCookie, SUPPLIER_SESSION_COOKIE } from '@/lib/supplier-session';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import {
  createPurchaseOrder,
  updatePurchaseOrderStatus,
} from '@/server/purchase-orders/service';
import { POST as POST_LOGIN } from './[code]/login/route';
import { GET as GET_POS } from './[code]/pos/route';
import { POST as POST_STATUS } from './[code]/status/route';
import { POST as POST_SHIP_DATE } from './[code]/ship-date/route';
import { POST as POST_COMMENT } from './[code]/comment/route';
import { GET as GET_PO } from './[code]/po/[poNumber]/route';

afterEach(async () => {
  await resetTestDb(db);
});

const PASSWORD = 'fish-tuesday';

async function seedSupplier(overrides: Partial<typeof schema.suppliers.$inferInsert> = {}) {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      name: 'Vast Apparel',
      supplierCode: 'VA',
      email: 'factory@example.com',
      portalPassword: PASSWORD,
      ...overrides,
    })
    .returning();
  return supplier;
}

async function seedSentPo(supplierId: string) {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice' }] }],
    }),
  );
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  }))!;
  const po = await createPurchaseOrder({
    orderId: created.orderId,
    supplierId,
    garmentIds: [garment.id],
  });
  await updatePurchaseOrderStatus(po.id, 'sent');
  return { po, orderId: created.orderId };
}

function cookieHeaderFor(supplier: { id: string; portalPassword: string | null }, name = 'Ana') {
  const cookie = buildSupplierSessionCookie({ supplier, name });
  return `${cookie.name}=${cookie.value}`;
}

function request(
  url: string,
  opts: { method?: string; body?: unknown; cookie?: string | null } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(`http://localhost${url}`, {
    method: opts.method ?? 'GET',
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
    headers,
  });
}

const withParams = <P,>(params: P) => ({ params: Promise.resolve(params) });

describe('POST /api/supplier/[code]/login', () => {
  it('sets the signed session cookie on the right password', async () => {
    await seedSupplier();
    const res = await POST_LOGIN(
      request('/api/supplier/VA/login', { method: 'POST', body: { password: PASSWORD, name: 'Ana' } }),
      withParams({ code: 'VA' }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, supplierName: 'Vast Apparel', name: 'Ana' });
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toContain(`${SUPPLIER_SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('answers 403 for a wrong password and identically for an unknown code', async () => {
    await seedSupplier();

    const wrongPassword = await POST_LOGIN(
      request('/api/supplier/VA/login', { method: 'POST', body: { password: 'nope', name: 'Ana' } }),
      withParams({ code: 'VA' }),
    );
    const unknownCode = await POST_LOGIN(
      request('/api/supplier/ZZ/login', { method: 'POST', body: { password: PASSWORD, name: 'Ana' } }),
      withParams({ code: 'ZZ' }),
    );

    expect(wrongPassword.status).toBe(403);
    expect(unknownCode.status).toBe(403);
    // Same body both ways — the gate must not confirm which codes exist.
    expect(await wrongPassword.json()).toEqual(await unknownCode.json());
    expect(wrongPassword.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a missing name or password with 400', async () => {
    await seedSupplier();
    const res = await POST_LOGIN(
      request('/api/supplier/VA/login', { method: 'POST', body: { password: PASSWORD } }),
      withParams({ code: 'VA' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/supplier/[code]/pos', () => {
  it('401s without a cookie (login_required)', async () => {
    await seedSupplier();
    const res = await GET_POS(request('/api/supplier/VA/pos'), withParams({ code: 'VA' }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('login_required');
  });

  it('lists the supplier\'s sent POs with the session cookie', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedSentPo(supplier.id);

    const res = await GET_POS(
      request('/api/supplier/VA/pos', { cookie: cookieHeaderFor(supplier) }),
      withParams({ code: 'VA' }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.supplierName).toBe('Vast Apparel');
    expect(json.name).toBe('Ana');
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({
      poId: po.id,
      poNumber: po.poNumber,
      status: 'sent',
      garmentNames: ['Team Hoodie'],
      totalUnits: 1,
    });
  });

  it('rejects a cookie made stale by a password rotation', async () => {
    const supplier = await seedSupplier();
    const staleCookie = cookieHeaderFor(supplier); // bound to the OLD password
    await db
      .update(schema.suppliers)
      .set({ portalPassword: 'rotated' })
      .where(eq(schema.suppliers.id, supplier.id));

    const res = await GET_POS(
      request('/api/supplier/VA/pos', { cookie: staleCookie }),
      withParams({ code: 'VA' }),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/supplier/[code]/status (bulk, per-PO results)', () => {
  it('returns one result per PO — a legal move succeeds beside an illegal one and a miss', async () => {
    const supplier = await seedSupplier();
    const { po: movable } = await seedSentPo(supplier.id);
    const { po: shipped } = await seedSentPo(supplier.id);
    await updatePurchaseOrderStatus(shipped.id, 'in_transit'); // pre_production is now backward

    const res = await POST_STATUS(
      request('/api/supplier/VA/status', {
        method: 'POST',
        body: {
          poNumbers: [movable.poNumber, shipped.poNumber, 'VA999'],
          status: 'pre_production',
        },
        cookie: cookieHeaderFor(supplier),
      }),
      withParams({ code: 'VA' }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results).toEqual([
      { poNumber: movable.poNumber, ok: true, status: 'pre_production' },
      { poNumber: shipped.poNumber, ok: false, error: 'That status change is not allowed' },
      { poNumber: 'VA999', ok: false, error: 'Not found' },
    ]);

    const row = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, movable.id),
    });
    expect(row!.status).toBe('pre_production');
  });

  it('401s without a cookie and 400s a staff-only status', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedSentPo(supplier.id);

    const noCookie = await POST_STATUS(
      request('/api/supplier/VA/status', {
        method: 'POST',
        body: { poNumbers: [po.poNumber], status: 'pre_production' },
      }),
      withParams({ code: 'VA' }),
    );
    expect(noCookie.status).toBe(401);

    // 'received' is the physical-goods checkpoint — not in the schema enum.
    const staffOnly = await POST_STATUS(
      request('/api/supplier/VA/status', {
        method: 'POST',
        body: { poNumbers: [po.poNumber], status: 'received' },
        cookie: cookieHeaderFor(supplier),
      }),
      withParams({ code: 'VA' }),
    );
    expect(staffOnly.status).toBe(400);
  });
});

describe('POST /api/supplier/[code]/ship-date', () => {
  it('sets the expected ship date for a PO still in flight', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedSentPo(supplier.id);

    const res = await POST_SHIP_DATE(
      request('/api/supplier/VA/ship-date', {
        method: 'POST',
        body: { poNumber: po.poNumber, expectedShipDate: '2026-10-01' },
        cookie: cookieHeaderFor(supplier),
      }),
      withParams({ code: 'VA' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, expectedShipDate: '2026-10-01' });
  });

  it('409s once the PO has shipped', async () => {
    const supplier = await seedSupplier();
    const { po } = await seedSentPo(supplier.id);
    await updatePurchaseOrderStatus(po.id, 'in_transit');

    const res = await POST_SHIP_DATE(
      request('/api/supplier/VA/ship-date', {
        method: 'POST',
        body: { poNumber: po.poNumber, expectedShipDate: '2026-10-01' },
        cookie: cookieHeaderFor(supplier),
      }),
      withParams({ code: 'VA' }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('has shipped');
  });
});

describe('GET /api/supplier/[code]/po/[poNumber] and POST comment', () => {
  it('serves the PO view to a session holder and 404s another supplier\'s number', async () => {
    const supplier = await seedSupplier();
    const rival = await seedSupplier({ name: 'Goal Sports', supplierCode: 'GOAL' });
    const { po } = await seedSentPo(supplier.id);

    const ok = await GET_PO(
      request(`/api/supplier/VA/po/${po.poNumber}`, { cookie: cookieHeaderFor(supplier) }),
      withParams({ code: 'VA', poNumber: po.poNumber }),
    );
    const json = await ok.json();
    expect(ok.status).toBe(200);
    expect(json.view.poNumber).toBe(po.poNumber);
    expect(json.name).toBe('Ana');

    // GOAL's session probing VA's number: not found, not forbidden.
    const cross = await GET_PO(
      request(`/api/supplier/GOAL/po/${po.poNumber}`, { cookie: cookieHeaderFor(rival) }),
      withParams({ code: 'GOAL', poNumber: po.poNumber }),
    );
    expect(cross.status).toBe(404);
  });

  it('posts a comment attributed to the named person', async () => {
    const supplier = await seedSupplier();
    const { po, orderId } = await seedSentPo(supplier.id);

    const res = await POST_COMMENT(
      request('/api/supplier/VA/comment', {
        method: 'POST',
        body: { poNumber: po.poNumber, body: 'Fabric arrives Tuesday.' },
        cookie: cookieHeaderFor(supplier),
      }),
      withParams({ code: 'VA' }),
    );
    expect(res.status).toBe(201);

    const notes = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, orderId),
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].authorLabel).toBe(`Ana (Vast Apparel, ${po.poNumber})`);
    expect(notes[0].visibility).toBe('shared');
  });
});
