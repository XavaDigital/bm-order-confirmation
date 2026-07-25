import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { env } from '@/lib/env';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { POST } from './route';
import { POST as POST_NOTE } from './[id]/notes/route';

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

  it('creates a platform-sourced order with the hub association and returns the link', async () => {
    const res = await POST(request('/api/capability/v1/orders', orderBody()));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.orderId).toBeTruthy();
    expect(json.token).toBeTruthy();
    expect(json.url).toContain('/o/');

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

  it('is idempotent on externalRef — a replay returns the existing order with 200', async () => {
    const first = await POST(request('/api/capability/v1/orders', orderBody()));
    const firstJson = await first.json();

    const replay = await POST(request('/api/capability/v1/orders', orderBody()));
    const replayJson = await replay.json();

    expect(replay.status).toBe(200);
    expect(replayJson.orderId).toBe(firstJson.orderId);
    expect(replayJson.existing).toBe(true);

    const count = await db.query.orders.findMany({
      where: eq(schema.orders.externalRef, 'EMAILFLOW-CARD-42'),
    });
    expect(count).toHaveLength(1);
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

  it('adds an attributed email_flow note and emits an outbox event', async () => {
    const created = await seedOrder();
    const res = await POST_NOTE(
      request(`/x`, { body: 'Customer emailed: hold shipment until Friday' }),
      { params: Promise.resolve({ id: created.orderId }) },
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.authorKind).toBe('email_flow');
    expect(json.authorLabel).toBe('core-user-1');

    const notes = await db.query.orderNotes.findMany({
      where: eq(schema.orderNotes.orderId, created.orderId),
    });
    expect(notes).toHaveLength(1);

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
});
