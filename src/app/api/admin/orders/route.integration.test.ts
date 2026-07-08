import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { getSession } from '@/lib/session';
import { GET, POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.email = 'staff@example.com';
});

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  };
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/orders', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/orders${query}`);
}

describe('POST /api/admin/orders', () => {
  it('returns 400 with details for an invalid body', async () => {
    const res = await POST(postRequest({ customer: { name: '' } }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 400 for a body with no garments', async () => {
    const res = await POST(postRequest(validPayload({ garments: [] })));
    expect(res.status).toBe(400);
  });

  it('returns 201 with orderId/orderNumber/token/url and persists the order', async () => {
    const res = await POST(postRequest(validPayload()));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.orderId).toBeTruthy();
    expect(json.orderNumber).toMatch(/^OC-/);
    expect(json.token).toBeTruthy();
    expect(json.url).toBeTruthy();

    const rows = await db.select().from(schema.orders);
    expect(rows).toHaveLength(1);
    expect(rows[0].customerName).toBe('Jane Coach');
  });
});

describe('GET /api/admin/orders', () => {
  it('returns an empty list with total 0 when there are no orders', async () => {
    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.orders).toEqual([]);
    expect(json.total).toBe(0);
  });

  it('lists created orders newest first', async () => {
    await POST(postRequest(validPayload({ customer: { name: 'Jane Coach', email: 'jane@example.com' } })));
    await POST(postRequest(validPayload({ customer: { name: 'Bob Coach', email: 'bob@example.com' } })));

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.total).toBe(2);
    expect(json.orders).toHaveLength(2);
    expect(json.orders[0].customerName).toBe('Bob Coach');
  });

  it('filters by status', async () => {
    await POST(postRequest(validPayload()));

    const res = await GET(getRequest('?status=sent'));
    const json = await res.json();

    expect(json.total).toBe(0);
    expect(json.orders).toEqual([]);
  });

  it('filters by search across customer name, order number, and club name', async () => {
    await POST(postRequest(validPayload({ customer: { name: 'Jane Coach', email: 'jane@example.com', clubName: 'Wildcats' } })));
    await POST(postRequest(validPayload({ customer: { name: 'Bob Coach', email: 'bob@example.com' } })));

    const res = await GET(getRequest('?search=wildcats'));
    const json = await res.json();

    expect(json.total).toBe(1);
    expect(json.orders[0].customerName).toBe('Jane Coach');
  });

  it('respects limit and offset', async () => {
    await POST(postRequest(validPayload({ customer: { name: 'A', email: 'a@example.com' } })));
    await POST(postRequest(validPayload({ customer: { name: 'B', email: 'b@example.com' } })));
    await POST(postRequest(validPayload({ customer: { name: 'C', email: 'c@example.com' } })));

    const res = await GET(getRequest('?limit=1&offset=1'));
    const json = await res.json();

    expect(json.total).toBe(3);
    expect(json.orders).toHaveLength(1);
    expect(json.orders[0].customerName).toBe('B');
  });

  it('applies sortBy and sortDir query params', async () => {
    await POST(postRequest(validPayload({ customer: { name: 'A', email: 'a@example.com' }, orderValue: { amount: 20, currency: 'NZD' } })));
    await POST(postRequest(validPayload({ customer: { name: 'B', email: 'b@example.com' }, orderValue: { amount: 5, currency: 'NZD' } })));

    const res = await GET(getRequest('?sortBy=orderValueAmount&sortDir=asc'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.orders.map((row: { customerName: string }) => row.customerName)).toEqual(['B', 'A']);
  });
});
