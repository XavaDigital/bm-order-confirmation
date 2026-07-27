import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      if (prop === 'destroy')
        return () => {
          for (const k of Object.keys(target)) delete target[k];
        };
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
      if (!session.userId)
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin')
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, getOrderAdmin } from '@/server/orders/service';
import { GET, POST } from './route';
import { DELETE, PATCH } from './[noteId]/route';

async function setSession(userId: string, role: 'sales' | 'admin' = 'sales') {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
  session.role = role;
  session.email = `${userId}@x.com`;
}

beforeEach(async () => {
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({ email: 'staff-1@x.com', name: 'Sam Sales', passwordHash: 'x', role: 'sales' })
    .returning();
  await setSession(staff.id);
});

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function currentUserId() {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  return session.userId as string;
}

async function seedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey' }],
    }),
  );
  const order = await getOrderAdmin(created.orderId);
  return { orderId: created.orderId, garmentId: order!.garments[0].id };
}

function listRequest(orderId: string, query = '') {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/notes${query}`);
}

function postRequest(orderId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchRequest(orderId: string, noteId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/notes/${noteId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest(orderId: string, noteId: string) {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/notes/${noteId}`, {
    method: 'DELETE',
  });
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

describe('POST /api/admin/orders/[id]/notes', () => {
  it('creates a note attributed to the signed-in user', async () => {
    const { orderId } = await seedOrder();

    const res = await POST(postRequest(orderId, { body: '<p>Chase the factory</p>' }), ctx({ id: orderId }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.body).toBe('Chase the factory');
    expect(json.authorStaffUserId).toBe(await currentUserId());
    expect(json.authorName).toBe('Sam Sales');
  });

  // The route does not sanitise; the service does. This proves the boundary
  // holds for a request that never came from our editor.
  it('stores no script even though the payload contained one', async () => {
    const { orderId } = await seedOrder();

    const res = await POST(
      postRequest(orderId, { body: '<p>hi</p><script>alert(1)</script>' }),
      ctx({ id: orderId }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.bodyHtml).not.toContain('script');
    const rows = await db.select().from(schema.orderNotes);
    expect(rows[0].bodyHtml).not.toContain('script');
  });

  it('400s on an empty body', async () => {
    const { orderId } = await seedOrder();

    const res = await POST(postRequest(orderId, { body: '<p><br></p>' }), ctx({ id: orderId }));

    expect(res.status).toBe(400);
    expect(await db.select().from(schema.orderNotes)).toHaveLength(0);
  });

  it('404s for an unknown order', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000';

    const res = await POST(postRequest(unknown, { body: '<p>x</p>' }), ctx({ id: unknown }));

    expect(res.status).toBe(404);
  });

  it('401s when not signed in', async () => {
    const { orderId } = await seedOrder();
    const session = (await getSession()) as unknown as Record<string, unknown>;
    for (const key of Object.keys(session)) delete session[key];

    const res = await POST(postRequest(orderId, { body: '<p>x</p>' }), ctx({ id: orderId }));

    expect(res.status).toBe(401);
  });

  it('409s for a garment from another order', async () => {
    const { orderId } = await seedOrder();
    const other = await seedOrder();

    const res = await POST(
      postRequest(orderId, { body: '<p>x</p>', garmentId: other.garmentId }),
      ctx({ id: orderId }),
    );

    expect(res.status).toBe(409);
  });
});

describe('GET /api/admin/orders/[id]/notes', () => {
  it('returns the order thread and excludes garment notes by default', async () => {
    const { orderId, garmentId } = await seedOrder();
    await POST(postRequest(orderId, { body: '<p>order-wide</p>' }), ctx({ id: orderId }));
    await POST(postRequest(orderId, { body: '<p>on the jersey</p>', garmentId }), ctx({ id: orderId }));

    const res = await GET(listRequest(orderId), ctx({ id: orderId }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.map((n: { body: string }) => n.body)).toEqual(['order-wide']);
  });

  it('filters to one garment with ?garmentId', async () => {
    const { orderId, garmentId } = await seedOrder();
    await POST(postRequest(orderId, { body: '<p>order-wide</p>' }), ctx({ id: orderId }));
    await POST(postRequest(orderId, { body: '<p>on the jersey</p>', garmentId }), ctx({ id: orderId }));

    const res = await GET(listRequest(orderId, `?garmentId=${garmentId}`), ctx({ id: orderId }));
    const json = await res.json();

    expect(json.map((n: { body: string }) => n.body)).toEqual(['on the jersey']);
  });

  it('returns everything with ?scope=all', async () => {
    const { orderId, garmentId } = await seedOrder();
    await POST(postRequest(orderId, { body: '<p>order-wide</p>' }), ctx({ id: orderId }));
    await POST(postRequest(orderId, { body: '<p>on the jersey</p>', garmentId }), ctx({ id: orderId }));

    const res = await GET(listRequest(orderId, '?scope=all'), ctx({ id: orderId }));

    expect(await res.json()).toHaveLength(2);
  });

  it('401s when not signed in', async () => {
    const { orderId } = await seedOrder();
    const session = (await getSession()) as unknown as Record<string, unknown>;
    for (const key of Object.keys(session)) delete session[key];

    const res = await GET(listRequest(orderId), ctx({ id: orderId }));

    expect(res.status).toBe(401);
  });
});

describe('PATCH/DELETE /api/admin/orders/[id]/notes/[noteId]', () => {
  async function seedNote() {
    const { orderId, garmentId } = await seedOrder();
    const res = await POST(postRequest(orderId, { body: '<p>mine</p>' }), ctx({ id: orderId }));
    const note = await res.json();
    return { orderId, garmentId, noteId: note.id as string };
  }

  it('lets the author edit their own note', async () => {
    const { orderId, noteId } = await seedNote();

    const res = await PATCH(
      patchRequest(orderId, noteId, { body: '<p>revised</p>' }),
      ctx({ id: orderId, noteId }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.body).toBe('revised');
  });

  it('409s when someone else tries to edit it', async () => {
    const { orderId, noteId } = await seedNote();
    const [other] = await db
      .insert(schema.staffUsers)
      .values({ email: 'boss@x.com', name: 'Boss', passwordHash: 'x', role: 'admin' })
      .returning();
    await setSession(other.id, 'admin');

    const res = await PATCH(
      patchRequest(orderId, noteId, { body: '<p>hijacked</p>' }),
      ctx({ id: orderId, noteId }),
    );

    expect(res.status).toBe(409);
  });

  it('soft-deletes for the author', async () => {
    const { orderId, noteId } = await seedNote();

    const res = await DELETE(deleteRequest(orderId, noteId), ctx({ id: orderId, noteId }));

    expect(res.status).toBe(200);
    const listed = await (await GET(listRequest(orderId), ctx({ id: orderId }))).json();
    expect(listed[0].deleted).toBe(true);
    expect(listed[0].body).toBe('');
  });

  it('lets an admin delete another user’s note', async () => {
    const { orderId, noteId } = await seedNote();
    const [admin] = await db
      .insert(schema.staffUsers)
      .values({ email: 'boss@x.com', name: 'Boss', passwordHash: 'x', role: 'admin' })
      .returning();
    await setSession(admin.id, 'admin');

    const res = await DELETE(deleteRequest(orderId, noteId), ctx({ id: orderId, noteId }));

    expect(res.status).toBe(200);
  });

  it('409s when a non-admin tries to delete someone else’s note', async () => {
    const { orderId, noteId } = await seedNote();
    const [other] = await db
      .insert(schema.staffUsers)
      .values({ email: 'pat@x.com', name: 'Pat', passwordHash: 'x', role: 'sales' })
      .returning();
    await setSession(other.id);

    const res = await DELETE(deleteRequest(orderId, noteId), ctx({ id: orderId, noteId }));

    expect(res.status).toBe(409);
  });

  // The note id is only reachable through the order it belongs to.
  it('404s for a note id from a different order', async () => {
    const { noteId } = await seedNote();
    const other = await seedOrder();

    const res = await PATCH(
      patchRequest(other.orderId, noteId, { body: '<p>x</p>' }),
      ctx({ id: other.orderId, noteId }),
    );

    expect(res.status).toBe(404);
  });
});
