import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { REQUIRED_ACK_KEYS } from '@/server/orders/customer-service';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function allAcks() {
  return REQUIRED_ACK_KEYS.map((key) => ({ key, text: `ack for ${key}` }));
}

function makeRequest(body: unknown, ip: string) {
  return new NextRequest('http://localhost/api/o/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

let ipCounter = 0;
function uniqueIp() {
  ipCounter++;
  return `10.0.0.${ipCounter}`;
}

describe('POST /api/o/confirm', () => {
  it('returns 400 with details for a malformed body (wrong ack count)', async () => {
    const created = await createOrder(minimalOrderInput());
    const req = makeRequest(
      { token: created.token, acknowledgments: allAcks().slice(0, 2) },
      uniqueIp(),
    );

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 404 for an unknown token', async () => {
    const req = makeRequest(
      { token: 'unknown-token', acknowledgments: allAcks() },
      uniqueIp(),
    );

    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it('returns 409 with code=already_confirmed on a double confirm', async () => {
    const created = await createOrder(minimalOrderInput());
    const ip = uniqueIp();

    const first = await POST(makeRequest({ token: created.token, acknowledgments: allAcks() }, ip));
    expect(first.status).toBe(200);

    const second = await POST(makeRequest({ token: created.token, acknowledgments: allAcks() }, ip));
    const json = await second.json();

    expect(second.status).toBe(409);
    expect(json.code).toBe('already_confirmed');
  });

  it('returns 200 with success/orderNumber/confirmedAt for a valid confirm', async () => {
    const created = await createOrder(minimalOrderInput());
    const req = makeRequest({ token: created.token, acknowledgments: allAcks() }, uniqueIp());

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.orderNumber).toMatch(/^OC-/);
    expect(json.confirmedAt).toBeTruthy();
  });

  it('returns 429 with a Retry-After header after 10 requests from the same IP', async () => {
    const ip = uniqueIp();

    // Send 10 requests (each with an unknown token so they don't succeed/consume
    // an order, but they still count against the rate limit since the limiter
    // runs before body parsing).
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest({ token: 'unknown-token', acknowledgments: allAcks() }, ip));
      expect(res.status).toBe(404);
    }

    const eleventh = await POST(
      makeRequest({ token: 'unknown-token', acknowledgments: allAcks() }, ip),
    );

    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get('Retry-After')).toBeTruthy();
  });
});
