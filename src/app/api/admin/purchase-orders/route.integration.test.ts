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
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { eq } from 'drizzle-orm';
import { GET, POST } from './route';
import { GET as GET_DETAIL, PATCH } from './[id]/route';
import { POST as POST_STATUS } from './[id]/status/route';
import { GET as GET_REVISIONS, POST as POST_REVISION } from './[id]/revisions/route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setStaffSession() {
  const [user] = await db
    .insert(schema.staffUsers)
    .values({ email: 'sam@example.com', passwordHash: 'x', name: 'Sam Staff' })
    .returning();
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = user.id;
  session.email = user.email;
  session.role = 'sales'; // all PO routes are staff-gated, not admin-only
  return user;
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
}

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedOrderAndSupplier() {
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
  }))!;
  return { supplier, orderId: created.orderId, garmentId: garment.id };
}

async function createPoViaRoute() {
  const { supplier, orderId, garmentId } = await seedOrderAndSupplier();
  const res = await POST(
    jsonRequest('/api/admin/purchase-orders', 'POST', {
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
    }),
  );
  return { po: await res.json(), status: res.status, supplier, orderId, garmentId };
}

describe('auth gate', () => {
  it('returns 401 without a session on every PO route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await GET(jsonRequest('/api/admin/purchase-orders', 'GET'))).status).toBe(401);
    expect((await POST(jsonRequest('/api/admin/purchase-orders', 'POST', {}))).status).toBe(401);
    expect((await GET_DETAIL(jsonRequest(`/api/admin/purchase-orders/${id}`, 'GET'), withId(id))).status).toBe(401);
    expect((await PATCH(jsonRequest(`/api/admin/purchase-orders/${id}`, 'PATCH', {}), withId(id))).status).toBe(401);
    expect((await POST_STATUS(jsonRequest(`/api/admin/purchase-orders/${id}/status`, 'POST', { status: 'sent' }), withId(id))).status).toBe(401);
    expect((await GET_REVISIONS(jsonRequest(`/api/admin/purchase-orders/${id}/revisions`, 'GET'), withId(id))).status).toBe(401);
    expect((await POST_REVISION(jsonRequest(`/api/admin/purchase-orders/${id}/revisions`, 'POST', { reason: 'x' }), withId(id))).status).toBe(401);
  });
});

describe('POST /api/admin/purchase-orders', () => {
  it('creates a PO for any staff session and returns 201 with the rev-1 snapshot', async () => {
    const staff = await setStaffSession();
    const { po, status, garmentId } = await createPoViaRoute();

    expect(status).toBe(201);
    expect(po.poNumber).toBe('VA1'); // {CODE}{seq} numbering (2026-08-05)
    expect(po.status).toBe('draft');
    expect(po.createdBy).toBe(staff.id);
    expect(po.revision.revisionNumber).toBe(1);
    expect(po.revision.snapshot.garments[0].garmentId).toBe(garmentId);
  });

  it('returns 400 for an invalid payload and 409 for cross-order garments', async () => {
    await setStaffSession();
    const { supplier, orderId } = await seedOrderAndSupplier();

    const invalid = await POST(
      jsonRequest('/api/admin/purchase-orders', 'POST', { orderId, supplierId: supplier.id, garmentIds: [] }),
    );
    expect(invalid.status).toBe(400);

    const other = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Other', email: 'o@example.com' },
        garments: [{ name: 'Other Jersey', sizing: [{ size: 'M' }] }],
      }),
    );
    const otherGarment = (await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, other.orderId),
    }))!;
    const conflict = await POST(
      jsonRequest('/api/admin/purchase-orders', 'POST', {
        orderId,
        supplierId: supplier.id,
        garmentIds: [otherGarment.id],
      }),
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toBe('One or more garments do not belong to this order');
  });
});

describe('GET /api/admin/purchase-orders (+detail)', () => {
  it('lists POs with join fields and filters by status', async () => {
    await setStaffSession();
    const { po } = await createPoViaRoute();

    const res = await GET(jsonRequest('/api/admin/purchase-orders', 'GET'));
    const list = await res.json();
    expect(res.status).toBe(200);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: po.id,
      poNumber: po.poNumber,
      supplierName: 'Vast Apparel',
      customerName: 'Jane Coach',
    });

    const filtered = await GET(jsonRequest('/api/admin/purchase-orders?status=sent', 'GET'));
    expect(await filtered.json()).toHaveLength(0);
  });

  it('returns the detail with supplier, order, revisions, and shipments', async () => {
    await setStaffSession();
    const { po, orderId } = await createPoViaRoute();

    const res = await GET_DETAIL(
      jsonRequest(`/api/admin/purchase-orders/${po.id}`, 'GET'),
      withId(po.id),
    );
    const detail = await res.json();
    expect(res.status).toBe(200);
    expect(detail.supplier.name).toBe('Vast Apparel');
    expect(detail.order).toMatchObject({ id: orderId, customerName: 'Jane Coach' });
    expect(detail.revisions).toHaveLength(1);
    expect(detail.shipments).toEqual([]);

    const missing = await GET_DETAIL(
      jsonRequest('/api/admin/purchase-orders/00000000-0000-4000-8000-000000000000', 'GET'),
      withId('00000000-0000-4000-8000-000000000000'),
    );
    expect(missing.status).toBe(404);
  });
});

describe('PATCH /api/admin/purchase-orders/[id]', () => {
  it('updates dates/notes and audits the ship-date move with from→to', async () => {
    await setStaffSession();
    const { po, orderId } = await createPoViaRoute();

    const res = await PATCH(
      jsonRequest(`/api/admin/purchase-orders/${po.id}`, 'PATCH', {
        expectedShipDate: '2026-09-15',
        notes: 'ship date agreed',
      }),
      withId(po.id),
    );
    const updated = await res.json();
    expect(res.status).toBe(200);
    expect(updated.expectedShipDate).toBe('2026-09-15');
    expect(updated.notes).toBe('ship date agreed');

    const audits = await db.query.auditEvents.findMany({
      where: eq(schema.auditEvents.aggregateId, orderId),
    });
    const shipDateAudit = audits.find((a) => a.eventType === 'po.ship_date_changed');
    expect(shipDateAudit).toBeDefined();
    expect(shipDateAudit!.payload).toEqual({
      poId: po.id,
      poNumber: po.poNumber,
      from: null,
      to: '2026-09-15',
    });
  });

  it('silently strips deadlineDate — the PO mirrors the order and is not per-PO editable', async () => {
    await setStaffSession();
    const { po } = await createPoViaRoute();

    const res = await PATCH(
      jsonRequest(`/api/admin/purchase-orders/${po.id}`, 'PATCH', {
        deadlineDate: '2026-09-15', // no longer part of the update contract
      }),
      withId(po.id),
    );
    const updated = await res.json();
    expect(res.status).toBe(200);
    expect(updated.deadlineDate).toBeNull(); // untouched (order has no deadline)
  });
});

describe('POST /api/admin/purchase-orders/[id]/status', () => {
  it('applies a legal transition and 409s an illegal one with the reason in the body', async () => {
    await setStaffSession();
    const { po } = await createPoViaRoute();

    const sent = await POST_STATUS(
      jsonRequest(`/api/admin/purchase-orders/${po.id}/status`, 'POST', { status: 'sent' }),
      withId(po.id),
    );
    expect(sent.status).toBe(200);
    expect((await sent.json()).status).toBe('sent');

    const backward = await POST_STATUS(
      jsonRequest(`/api/admin/purchase-orders/${po.id}/status`, 'POST', { status: 'draft' }),
      withId(po.id),
    );
    expect(backward.status).toBe(409);
    expect((await backward.json()).error).toBe('Cannot move a sent purchase order to draft');

    const invalid = await POST_STATUS(
      jsonRequest(`/api/admin/purchase-orders/${po.id}/status`, 'POST', { status: 'not-a-status' }),
      withId(po.id),
    );
    expect(invalid.status).toBe(400);
  });
});

describe('/api/admin/purchase-orders/[id]/revisions', () => {
  it('POST issues a new revision (201) and GET lists newest first', async () => {
    await setStaffSession();
    const { po } = await createPoViaRoute();

    const noReason = await POST_REVISION(
      jsonRequest(`/api/admin/purchase-orders/${po.id}/revisions`, 'POST', {}),
      withId(po.id),
    );
    expect(noReason.status).toBe(400);

    const res = await POST_REVISION(
      jsonRequest(`/api/admin/purchase-orders/${po.id}/revisions`, 'POST', {
        reason: 'sizes corrected',
      }),
      withId(po.id),
    );
    const revision = await res.json();
    expect(res.status).toBe(201);
    expect(revision.revisionNumber).toBe(2);
    expect(revision.reason).toBe('sizes corrected');

    const list = await GET_REVISIONS(
      jsonRequest(`/api/admin/purchase-orders/${po.id}/revisions`, 'GET'),
      withId(po.id),
    );
    const revisions = await list.json();
    expect(list.status).toBe(200);
    expect(revisions.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([2, 1]);
  });
});
