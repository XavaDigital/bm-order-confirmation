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
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, setOrderAccessCode } from '@/server/orders/service';
import { REQUIRED_ACK_KEYS } from '@/server/orders/customer-service';
import { buildAccessCodeCookie, ACCESS_CODE_COOKIE } from '@/lib/access-code';
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

function makeRequest(body: unknown, ip: string, cookie?: string) {
  return new NextRequest('http://localhost/api/o/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...(cookie ? { cookie: `${ACCESS_CODE_COOKIE}=${cookie}` } : {}),
    },
  });
}

function makeRawRequest(rawBody: string, ip: string) {
  return new NextRequest('http://localhost/api/o/confirm', {
    method: 'POST',
    body: rawBody,
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

  it('returns 400 for a request body that is not valid JSON', async () => {
    const res = await POST(makeRawRequest('not-json{{', uniqueIp()));

    expect(res.status).toBe(400);
  });

  it('returns 400 with code=missing_ack:<key> when a required acknowledgment key is missing', async () => {
    const created = await createOrder(minimalOrderInput());
    // Keep the array length valid per the Zod schema, but duplicate a key so a
    // required one is actually absent — this triggers the service-level check.
    const acks = allAcks();
    acks[acks.length - 1] = { ...acks[0] };

    const res = await POST(makeRequest({ token: created.token, acknowledgments: acks }, uniqueIp()));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toMatch(/^missing_ack:/);
  });

  it('returns 403 with code=code_required when the order has an access code and no valid cookie is present', async () => {
    const created = await createOrder(minimalOrderInput());
    const { code } = await setOrderAccessCode(created.orderId);
    void code;

    const res = await POST(makeRequest({ token: created.token, acknowledgments: allAcks() }, uniqueIp()));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('code_required');
  });

  it('succeeds when the access-code cookie is present and valid', async () => {
    const created = await createOrder(minimalOrderInput());
    await setOrderAccessCode(created.orderId);
    const access = await db.query.orderAccess.findFirst({ where: eq(schema.orderAccess.orderId, created.orderId) });
    const cookie = buildAccessCodeCookie({ id: access!.id, accessCodeHash: access!.accessCodeHash! });

    const res = await POST(
      makeRequest({ token: created.token, acknowledgments: allAcks() }, uniqueIp(), cookie.value),
    );

    expect(res.status).toBe(200);
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
