/**
 * Route-level tests for GET /api/admin/orders/[id]/address-label (David,
 * 2026-08-05): a one-per-page PDF of the order's shipping address at label
 * size. 404 unknown order, 409 when there is no address to print, 200
 * application/pdf otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

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
import { getSession } from '@/lib/session';
import * as schema from '@/db/schema';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { GET } from './route';

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'viewer'; // printing a label is a read
  session.email = 'viewer@x.com';
});

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedOrder(opts: { clubName?: string } = {}) {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: {
        name: 'Jane Coach',
        email: 'jane@example.com',
        ...(opts.clubName && { clubName: opts.clubName }),
      },
      garments: [{ name: 'Team Hoodie' }],
    }),
  );
  return created;
}

async function setAddress(orderId: string, address: Record<string, unknown> | null) {
  await db
    .update(schema.orders)
    .set({ shippingAddress: address })
    .where(eq(schema.orders.id, orderId));
}

const request = (id: string) =>
  new NextRequest(`http://localhost/api/admin/orders/${id}/address-label`, { method: 'GET' });
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/admin/orders/[id]/address-label', () => {
  it('401s without a session', async () => {
    const session = (await getSession()) as unknown as Record<string, unknown>;
    for (const key of Object.keys(session)) delete session[key];

    const res = await GET(request('x'), withId('00000000-0000-4000-8000-000000000000'));
    expect(res.status).toBe(401);
  });

  it('404s an unknown order', async () => {
    const res = await GET(
      request('missing'),
      withId('00000000-0000-4000-8000-000000000000'),
    );
    expect(res.status).toBe(404);
  });

  it('409s when the order has no shipping address, or only blank values', async () => {
    const order = await seedOrder();

    const noAddress = await GET(request(order.orderId), withId(order.orderId));
    expect(noAddress.status).toBe(409);
    expect((await noAddress.json()).error).toContain('no shipping address');

    // Keys present but nothing printable — still a 409, not a blank label.
    await setAddress(order.orderId, { line1: '   ', city: '' });
    const blank = await GET(request(order.orderId), withId(order.orderId));
    expect(blank.status).toBe(409);
  });

  it('renders a PDF when the address has printable lines', async () => {
    const order = await seedOrder({ clubName: 'Westside Wildcats' });
    await setAddress(order.orderId, {
      line1: '1 Main Street',
      line2: 'Unit 4',
      city: 'Auckland',
      postcode: '1010',
      country: 'New Zealand',
    });

    const res = await GET(request(order.orderId), withId(order.orderId));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(
      `address-label-${order.orderNumber}.pdf`,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('renders when only one address key is present', async () => {
    const order = await seedOrder();
    await setAddress(order.orderId, { city: 'Auckland' });

    const res = await GET(request(order.orderId), withId(order.orderId));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
