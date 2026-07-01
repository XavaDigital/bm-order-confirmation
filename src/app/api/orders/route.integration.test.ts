import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { POST, GET } from './route';

const API_KEY = 'test-internal-api-key-0123456789';

afterEach(async () => {
  await resetTestDb(db);
});

function validPayload() {
  return {
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
  };
}

describe('POST /api/orders', () => {
  it('returns 401 with a missing x-api-key and writes no row', async () => {
    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify(validPayload()),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });

  it('returns 401 with a wrong x-api-key and writes no row', async () => {
    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify(validPayload()),
      headers: { 'content-type': 'application/json', 'x-api-key': 'totally-wrong-key' },
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      body: '{not valid json',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 422 with details for schema-valid JSON that fails the contract (no garments)', async () => {
    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify({ customer: { name: 'Jane Coach', email: 'jane@example.com' }, garments: [] }),
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.details).toBeDefined();
  });

  it('returns 201 with orderId/orderNumber/token/url for a valid payload and correct key', async () => {
    const req = new Request('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify(validPayload()),
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.orderId).toBeTruthy();
    expect(json.orderNumber).toMatch(/^OC-/);
    expect(json.token).toBeTruthy();
    expect(json.url).toBeTruthy();
  });
});

describe('GET /api/orders', () => {
  it('returns 401 with a missing key', async () => {
    const req = new Request('http://localhost/api/orders', { method: 'GET' });

    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('returns 200 with an orders array for a valid key', async () => {
    const createReq = new Request('http://localhost/api/orders', {
      method: 'POST',
      body: JSON.stringify(validPayload()),
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
    });
    await POST(createReq);

    const req = new Request('http://localhost/api/orders', {
      method: 'GET',
      headers: { 'x-api-key': API_KEY },
    });
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(json.orders.orders)).toBe(true);
    expect(json.orders.orders).toHaveLength(1);
  });
});
