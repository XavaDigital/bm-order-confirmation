import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

// A hoisted holder rather than per-test mockResolvedValue: the factory's
// closures read it at CALL time, so the stubs hold regardless of how the
// runner resets mock implementations between registrations.
const hubStub = vi.hoisted(() => ({
  customer: null as { id: string; name: string; email?: string | null } | null,
  contact: null as { id: string; name: string; email?: string | null } | null,
}));
vi.mock('@/server/hub/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/hub/client')>();
  return {
    ...actual,
    getHubCustomer: vi.fn(async () => hubStub.customer),
    getHubContact: vi.fn(async () => hubStub.contact),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { env } from '@/lib/env';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { POST, GET } from './route';
import { POST as POST_NOTE, GET as GET_NOTES } from './[id]/notes/route';
import { createPurchaseOrder, updatePurchaseOrderStatus } from '@/server/purchase-orders/service';

const SECRET = 'per-app-inbound-secret';
const mutableEnv = env as { INBOUND_CAPABILITY_SECRET?: string };

beforeEach(() => {
  mutableEnv.INBOUND_CAPABILITY_SECRET = SECRET;
});

afterEach(async () => {
  await resetTestDb(db);
  delete mutableEnv.INBOUND_CAPABILITY_SECRET;
});

function request(
  url: string,
  body: unknown,
  opts: { secret?: string | null; actingUser?: string | null } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const secret = opts.secret === undefined ? SECRET : opts.secret;
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  const actingUser = opts.actingUser === undefined ? 'core-user-1' : opts.actingUser;
  if (actingUser !== null) headers['x-acting-user'] = actingUser;
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    externalRef: 'EMAILFLOW-CARD-42',
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    hubCustomerId: '7d9a1a10-2c3b-4d5e-8f90-aa11bb22cc33',
    hubCustomerName: 'Wildcats Netball',
    ...overrides,
  };
}

describe('POST /api/capability/v1/orders', () => {
  it('returns 503 when the inbound secret is not configured', async () => {
    delete mutableEnv.INBOUND_CAPABILITY_SECRET;
    const res = await POST(request('/api/capability/v1/orders', orderBody()));
    expect(res.status).toBe(503);
  });

  it('returns 401 for a wrong or missing bearer', async () => {
    const wrong = await POST(request('/api/capability/v1/orders', orderBody(), { secret: 'nope' }));
    expect(wrong.status).toBe(401);

    const missing = await POST(request('/api/capability/v1/orders', orderBody(), { secret: null }));
    expect(missing.status).toBe(401);
  });

  it('returns 400 without an X-Acting-User header', async () => {
    const res = await POST(request('/api/capability/v1/orders', orderBody(), { actingUser: null }));
    expect(res.status).toBe(400);
  });

  it('creates a platform-sourced order and returns the relay contract: id + ADMIN deep link, never the magic link', async () => {
    const res = await POST(request('/api/capability/v1/orders', orderBody()));
    const json = await res.json();

    expect(res.status).toBe(201);
    // The hub relay reads `id` and registers `url` as the CRM deep link
    // (fleet thread 2026-08-01) — so the url must be the admin page, and the
    // customer magic-link token must not cross this surface at all.
    expect(json.id).toBeTruthy();
    expect(json.orderId).toBe(json.id);
    expect(json.created).toBe(true);
    expect(json.url).toContain(`/admin/orders/${json.id}`);
    expect(json.url).not.toContain('/o/');
    expect(json.token).toBeUndefined();

    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, json.orderId) });
    expect(order!.source).toBe('platform');
    expect(order!.externalRef).toBe('EMAILFLOW-CARD-42');
    expect(order!.hubCustomerName).toBe('Wildcats Netball');
  });

  it('forces source to platform even if the caller claims internal_admin', async () => {
    const res = await POST(
      request('/api/capability/v1/orders', orderBody({ source: 'internal_admin' })),
    );
    const json = await res.json();
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, json.orderId) });
    expect(order!.source).toBe('platform');
  });

  it('assigns sequential OC-<n> order numbers (David, 2026-08-02)', async () => {
    const first = await POST(request('/api/capability/v1/orders', orderBody({ externalRef: 'seq-1' })));
    const second = await POST(request('/api/capability/v1/orders', orderBody({ externalRef: 'seq-2' })));
    const a = (await first.json()).orderNumber as string;
    const b = (await second.json()).orderNumber as string;

    expect(a).toMatch(/^OC-\d{5,}$/);
    expect(b).toMatch(/^OC-\d{5,}$/);
    // Strictly consecutive within this test — nothing else draws between them.
    expect(Number(b.slice(3))).toBe(Number(a.slice(3)) + 1);
    expect(Number(a.slice(3))).toBeGreaterThanOrEqual(10001);
  });

  it('is idempotent on externalRef — a replay returns the existing order with 200', async () => {
    const first = await POST(request('/api/capability/v1/orders', orderBody()));
    const firstJson = await first.json();

    const replay = await POST(request('/api/capability/v1/orders', orderBody()));
    const replayJson = await replay.json();

    expect(replay.status).toBe(200);
    expect(replayJson.id).toBe(firstJson.id);
    expect(replayJson.orderId).toBe(firstJson.orderId);
    expect(replayJson.created).toBe(false);
    expect(replayJson.existing).toBe(true);

    const count = await db.query.orders.findMany({
      where: eq(schema.orders.externalRef, 'EMAILFLOW-CARD-42'),
    });
    expect(count).toHaveLength(1);
  });
});

describe('GET /api/capability/v1/orders?customerId= (full-state index rows for read-repair)', () => {
  const HUB_CUSTOMER = '7d9a1a10-2c3b-4d5e-8f90-aa11bb22cc33';

  function getRequest(customerId: string | null, opts: { secret?: string | null } = {}) {
    const headers: Record<string, string> = {};
    const secret = opts.secret === undefined ? SECRET : opts.secret;
    if (secret !== null) headers.authorization = `Bearer ${secret}`;
    const qs = customerId === null ? '' : `?customerId=${encodeURIComponent(customerId)}`;
    return new NextRequest(`http://localhost/api/capability/v1/orders${qs}`, { headers });
  }

  async function seedHubOrder() {
    const created = await createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane Coach', email: 'jane@example.com', clubName: 'Wildcats' },
        garments: [{ name: 'Jersey', sizing: [{ size: 'M', playerName: 'Alice' }] }],
      }),
    );
    await db
      .update(schema.orders)
      .set({ hubCustomerId: HUB_CUSTOMER })
      .where(eq(schema.orders.id, created.orderId));
    return created;
  }

  it('requires auth and a customerId', async () => {
    expect((await GET(getRequest(HUB_CUSTOMER, { secret: 'bad' }))).status).toBe(401);
    expect((await GET(getRequest(null))).status).toBe(400);
  });

  it('returns the full-state rows with the staff-only PO summary block', async () => {
    const created = await seedHubOrder();
    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: 'Vast Apparel', supplierCode: 'VA' })
      .returning();
    const garment = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    });
    const po = await createPurchaseOrder({
      orderId: created.orderId,
      supplierId: supplier.id,
      garmentIds: [garment!.id],
      expectedShipDate: '2026-09-15',
    });
    await updatePurchaseOrderStatus(po.id, 'sent');

    const res = await GET(getRequest(HUB_CUSTOMER));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.items).toHaveLength(1);
    const row = json.items[0];
    expect(row).toMatchObject({
      externalId: created.orderId,
      orderNumber: created.orderNumber,
      name: 'Wildcats', // no order name — falls back to the club label
      status: 'draft',
      url: expect.stringContaining(`/admin/orders/${created.orderId}`),
    });
    expect(row.pos).toHaveLength(1);
    expect(row.pos[0]).toMatchObject({
      id: po.id,
      poNumber: po.poNumber,
      status: 'sent',
      expectedShipDate: '2026-09-15',
      supplierName: 'Vast Apparel',
    });
    // History: born draft, then the sent transition, oldest first.
    expect(row.pos[0].statusHistory.map((h: { status: string }) => h.status)).toEqual([
      'draft',
      'sent',
    ]);
  });

  it('returns an empty list for a customer with no orders (full-state truth, not 404)', async () => {
    await seedHubOrder();
    const res = await GET(getRequest('00000000-0000-4000-8000-00000000dead'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.items).toEqual([]);
  });
});

describe('POST /api/capability/v1/orders/[id]/notes', () => {
  async function seedOrder() {
    return createOrder(
      createOrderSchema.parse({
        customer: { name: 'Jane Coach', email: 'jane@example.com' },
        garments: [{ name: 'Jersey' }],
      }),
    );
  }

  it('applies the same auth gates as order creation', async () => {
    const created = await seedOrder();
    const params = { params: Promise.resolve({ id: created.orderId }) };

    delete mutableEnv.INBOUND_CAPABILITY_SECRET;
    expect((await POST_NOTE(request(`/x`, { body: 'hi' }), params)).status).toBe(503);

    mutableEnv.INBOUND_CAPABILITY_SECRET = SECRET;
    expect((await POST_NOTE(request(`/x`, { body: 'hi' }, { secret: 'bad' }), params)).status).toBe(401);
    expect((await POST_NOTE(request(`/x`, { body: 'hi' }, { actingUser: null }), params)).status).toBe(400);
  });

  it('adds an attributed email_flow ORDER NOTE (kind note) and emits an outbox event', async () => {
    const created = await seedOrder();
    const res = await POST_NOTE(
      request(`/x`, { body: 'Customer emailed: hold shipment until Friday' }),
      { params: Promise.resolve({ id: created.orderId }) },
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.authorKind).toBe('email_flow');
    expect(json.authorLabel).toBe('core-user-1');
    // David's 2026-08-04 distinction: relayed notes are finalisation points,
    // not thread comments.
    expect(json.kind).toBe('note');
    // FLEET_STANDARD_ANNOTATIONS §5.2: the owner's response carries the
    // canonical envelope — this is what the hub's write-through caches.
    expect(json.envelope).toMatchObject({
      id: json.id,
      schemaVersion: 1,
      subject: { type: 'order', id: created.orderId, app: 'bm-orders' },
      kind: 'note',
      body: { text: 'Customer emailed: hold shipment until Friday', format: 'plain' },
      author: { kind: 'staff', label: 'core-user-1' },
      audience: [],
    });
    expect(json.envelope.occurredAt).toBeTruthy();
    expect(json.envelope.pushRef).toBeUndefined();

    const notes = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, created.orderId),
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe('note');

    const events = await db.query.domainEvents.findMany({
      where: eq(schema.domainEvents.aggregateId, created.orderId),
    });
    expect(events.some((e) => e.eventType === 'order.note_added')).toBe(true);
  });

  it('returns 404 for an unknown order', async () => {
    const res = await POST_NOTE(request(`/x`, { body: 'hi' }), {
      params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET returns the live order-notes list in an {items} envelope — comments excluded', async () => {
    const created = await seedOrder();
    const params = { params: Promise.resolve({ id: created.orderId }) };
    await POST_NOTE(request(`/x`, { body: 'Sleeves 1cm shorter' }), params);
    // A discussion comment must NOT appear on this surface.
    const { addOrderNote } = await import('@/server/orders/notes-service');
    await addOrderNote(created.orderId, { body: 'internal chatter', authorKind: 'staff' });

    const getReq = new NextRequest('http://localhost/x', {
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}`, 'x-acting-user': 'core-user-1' },
    });
    const res = await GET_NOTES(getReq, params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({
      body: 'Sleeves 1cm shorter',
      authorKind: 'email_flow',
      authorLabel: 'core-user-1',
    });
    expect(json.items[0].id).toBeTruthy();
    expect(json.items[0].createdAt).toBeTruthy();
    // §7 one-serializer: the repair read carries the same envelope shape the
    // push emits, keyed on the row uuid. Additive — the flat fields above stay.
    expect(json.items[0].envelope).toMatchObject({
      id: json.items[0].id,
      schemaVersion: 1,
      subject: { type: 'order', id: created.orderId, app: 'bm-orders' },
      kind: 'note',
      body: { text: 'Sleeves 1cm shorter', format: 'plain' },
      author: { kind: 'staff', label: 'core-user-1' },
      audience: [],
    });
    expect(json.items[0].envelope.pushRef).toBeUndefined();
  });
});


/**
 * The email-relay create (fleet thread 2026-07-31, David's ruling): the relay
 * carries hubCustomerId — never a customer name — and my side resolves the
 * person from the hub. Minimal body: { hubCustomerId, externalRef, name?,
 * notes? }, no customer block, no garments.
 */
describe('POST /api/capability/v1/orders — hub relay body', () => {
  const HUB_CUSTOMER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const HUB_CONTACT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  function relayRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/capability/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.INBOUND_CAPABILITY_SECRET}`,
        'X-Acting-User': 'sam@beastmode.co.nz',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  it('creates a draft from hubCustomerId alone, resolving the customer from the hub', async () => {
    hubStub.customer = { id: HUB_CUSTOMER, name: 'Wildcats Netball', email: 'club@wildcats.nz' };
    hubStub.contact = { id: HUB_CONTACT, name: 'Jane Coach', email: 'jane@wildcats.nz' };

    const res = await POST(relayRequest({
      hubCustomerId: HUB_CUSTOMER,
      hubContactId: HUB_CONTACT,
      externalRef: 'hub-order-1',
      name: 'Winter hoodies 2026',
      notes: 'Customer wants a quote by Friday',
    }));

    const resBody = await res.clone().json();
    expect({ status: res.status, body: resBody }).toMatchObject({ status: 201 });
    const row = await db.query.orders.findFirst({
      where: eq(schema.orders.externalRef, 'hub-order-1'),
    });
    expect(row).toMatchObject({
      status: 'draft',
      // The composer's label is a real column (David, 2026-08-02).
      name: 'Winter hoodies 2026',
      // The person is the contact; the row name is the org.
      customerName: 'Jane Coach',
      customerEmail: 'jane@wildcats.nz',
      clubName: 'Wildcats Netball',
      hubCustomerId: HUB_CUSTOMER,
      hubCustomerName: 'Wildcats Netball',
      hubContactId: HUB_CONTACT,
      hubContactName: 'Jane Coach',
    });
    // The composer's note becomes an ORDER NOTE row (David, 2026-08-04) —
    // no longer folded into the retired internalNotes field.
    expect(row!.internalNotes).toBeNull();
    const notes = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, row!.id),
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      body: 'Customer wants a quote by Friday',
      kind: 'note',
      authorKind: 'email_flow',
      authorLabel: 'sam@beastmode.co.nz',
    });
  });

  it('503s (and creates nothing) when the hub cannot resolve the customer — the relay retries', async () => {
    hubStub.customer = null;

    const res = await POST(relayRequest({ hubCustomerId: HUB_CUSTOMER, externalRef: 'hub-order-2' }));

    expect(res.status).toBe(503);
    expect(await db.query.orders.findFirst({
      where: eq(schema.orders.externalRef, 'hub-order-2'),
    })).toBeUndefined();
  });

  // The standalone contract is unchanged: no hub id means the old rules.
  it('still refuses a standalone create with no customer or garments', () => {
    expect(() => createOrderSchema.parse({})).toThrow();
    expect(() =>
      createOrderSchema.parse({ customer: { name: 'A', email: 'a@b.c' } }),
    ).toThrow(/at least one garment/);
  });
});
