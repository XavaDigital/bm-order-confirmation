import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, generateAccessToken, setOrderAccessCode } from '@/server/orders/service';
import { confirmOrder, REQUIRED_ACK_KEYS } from '@/server/orders/customer-service';
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

function makeRequest(body: unknown, ip: string, cookie?: string) {
  return new NextRequest('http://localhost/api/o/request-changes', {
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
  return new NextRequest('http://localhost/api/o/request-changes', {
    method: 'POST',
    body: rawBody,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

let ipCounter = 0;
function uniqueIp() {
  ipCounter++;
  return `10.1.0.${ipCounter}`;
}

describe('POST /api/o/request-changes', () => {
  it('returns 400 for an invalid body', async () => {
    const res = await POST(makeRequest({ token: '', comment: '' }, uniqueIp()));
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await POST(makeRequest({ token: 'totally-bogus', comment: 'please change it' }, uniqueIp()));
    expect(res.status).toBe(404);
  });

  it('returns 400 for a request body that is not valid JSON', async () => {
    const res = await POST(makeRawRequest('not-json{{', uniqueIp()));
    expect(res.status).toBe(400);
  });

  it('returns 403 with code=code_required when the order has an access code and no valid cookie is present', async () => {
    const created = await createOrder(minimalOrderInput());
    await setOrderAccessCode(created.orderId);

    const res = await POST(makeRequest({ token: created.token, comment: 'please change it' }, uniqueIp()));
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
      makeRequest({ token: created.token, comment: 'please change it' }, uniqueIp(), cookie.value),
    );

    expect(res.status).toBe(200);
  });

  it('returns 200 with the order number and updates status to changes_requested', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(makeRequest({ token: created.token, comment: 'Make it bigger' }, uniqueIp()));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, orderNumber: created.orderNumber });

    const row = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(row!.status).toBe('changes_requested');
  });

  it('returns 409 for an already-confirmed order', async () => {
    const created = await createOrder(minimalOrderInput());
    await confirmOrder({
      rawToken: created.token,
      acks: REQUIRED_ACK_KEYS.map((key) => ({ key, text: `ack for ${key}` })),
      signatureType: 'none',
    });

    const res = await POST(makeRequest({ token: created.token, comment: 'wait, actually...' }, uniqueIp()));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('already_confirmed');
  });

  it('returns 429 after exceeding the rate limit for a single IP', async () => {
    const created = await createOrder(minimalOrderInput());
    const ip = uniqueIp();

    for (let i = 0; i < 10; i++) {
      await POST(makeRequest({ token: created.token, comment: `attempt ${i}` }, ip));
    }
    const res = await POST(makeRequest({ token: created.token, comment: 'one too many' }, ip));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});
