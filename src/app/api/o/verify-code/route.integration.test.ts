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
import { ACCESS_CODE_COOKIE, isAccessCodeCookieValid } from '@/lib/access-code';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalOrderInput() {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
  });
}

function makeRequest(body: unknown, ip: string) {
  return new NextRequest('http://localhost/api/o/verify-code', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

let ipCounter = 0;
function uniqueIp() {
  ipCounter++;
  return `10.2.0.${ipCounter}`;
}

async function seedCodedOrder() {
  const created = await createOrder(minimalOrderInput());
  const { code } = await setOrderAccessCode(created.orderId);
  return { ...created, code };
}

describe('POST /api/o/verify-code', () => {
  it('returns 400 for an invalid body', async () => {
    const res = await POST(makeRequest({ token: '', code: '' }, uniqueIp()));
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await POST(makeRequest({ token: 'totally-bogus', code: '123456' }, uniqueIp()));
    expect(res.status).toBe(404);
  });

  it('returns 401 for a wrong code and does not set a cookie', async () => {
    const seeded = await seedCodedOrder();
    const wrong = seeded.code === '000000' ? '000001' : '000000';

    const res = await POST(makeRequest({ token: seeded.token, code: wrong }, uniqueIp()));

    expect(res.status).toBe(401);
    expect(res.cookies.get(ACCESS_CODE_COOKIE)).toBeUndefined();
  });

  it('returns 200 for the right code and sets a valid HttpOnly verification cookie', async () => {
    const seeded = await seedCodedOrder();

    const res = await POST(makeRequest({ token: seeded.token, code: seeded.code }, uniqueIp()));

    expect(res.status).toBe(200);
    const cookie = res.cookies.get(ACCESS_CODE_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);

    const access = await db.query.orderAccess.findFirst({
      where: eq(schema.orderAccess.orderId, seeded.orderId),
    });
    expect(
      isAccessCodeCookieValid(
        { id: access!.id, accessCodeHash: access!.accessCodeHash },
        cookie!.value,
      ),
    ).toBe(true);
  });

  it('rate-limits guesses per link even across different IPs', async () => {
    const seeded = await seedCodedOrder();
    const wrong = seeded.code === '000000' ? '000001' : '000000';

    for (let i = 0; i < 10; i++) {
      await POST(makeRequest({ token: seeded.token, code: wrong }, uniqueIp()));
    }
    const res = await POST(makeRequest({ token: seeded.token, code: seeded.code }, uniqueIp()));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});
