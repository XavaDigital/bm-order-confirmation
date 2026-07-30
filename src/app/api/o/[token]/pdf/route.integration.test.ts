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
import { confirmOrder, REQUIRED_ACK_KEYS } from '@/server/orders/customer-service';
import { buildAccessCodeCookie, ACCESS_CODE_COOKIE } from '@/lib/access-code';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey', sizing: [{ size: 'M', playerName: 'Alice' }] }],
    ...overrides,
  });
}

function allAcks() {
  return REQUIRED_ACK_KEYS.map((key) => ({ key, text: `ack for ${key}` }));
}

function getRequest(token: string, ip: string, cookie?: string) {
  return new NextRequest(`http://localhost/api/o/${token}/pdf`, {
    headers: {
      'x-forwarded-for': ip,
      ...(cookie ? { cookie: `${ACCESS_CODE_COOKIE}=${cookie}` } : {}),
    },
  });
}

let ipCounter = 0;
function uniqueIp() {
  ipCounter++;
  return `10.0.1.${ipCounter}`;
}

describe('GET /api/o/[token]/pdf', () => {
  it('returns 404 for an unknown token', async () => {
    const res = await GET(getRequest('unknown-token', uniqueIp()), {
      params: Promise.resolve({ token: 'unknown-token' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 404 when the order has not been confirmed yet', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await GET(getRequest(created.token, uniqueIp()), {
      params: Promise.resolve({ token: created.token }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 200 with a PDF content-type and attachment filename once confirmed', async () => {
    const created = await createOrder(minimalOrderInput());
    await confirmOrder({ rawToken: created.token, acks: allAcks(), signatureType: 'none' });

    const res = await GET(getRequest(created.token, uniqueIp()), {
      params: Promise.resolve({ token: created.token }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(`${created.orderNumber}.pdf`);

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('returns 403 with code=code_required for a confirmed order behind an access code with no cookie', async () => {
    const created = await createOrder(minimalOrderInput());
    await setOrderAccessCode(created.orderId);
    const access = await db.query.orderAccess.findFirst({ where: eq(schema.orderAccess.orderId, created.orderId) });
    const cookie = buildAccessCodeCookie({ id: access!.id, accessCodeHash: access!.accessCodeHash! });
    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
      codeCookie: cookie.value,
    });

    const res = await GET(getRequest(created.token, uniqueIp()), {
      params: Promise.resolve({ token: created.token }),
    });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('code_required');
  });

  it('succeeds for a confirmed, access-coded order when the verification cookie is present', async () => {
    const created = await createOrder(minimalOrderInput());
    await setOrderAccessCode(created.orderId);
    const access = await db.query.orderAccess.findFirst({ where: eq(schema.orderAccess.orderId, created.orderId) });
    const cookie = buildAccessCodeCookie({ id: access!.id, accessCodeHash: access!.accessCodeHash! });
    await confirmOrder({
      rawToken: created.token,
      acks: allAcks(),
      signatureType: 'none',
      codeCookie: cookie.value,
    });

    const res = await GET(getRequest(created.token, uniqueIp(), cookie.value), {
      params: Promise.resolve({ token: created.token }),
    });

    expect(res.status).toBe(200);
  });

  it('returns 429 with a Retry-After header after 20 requests from the same IP', async () => {
    const ip = uniqueIp();

    for (let i = 0; i < 20; i++) {
      const res = await GET(getRequest('unknown-token', ip), {
        params: Promise.resolve({ token: 'unknown-token' }),
      });
      expect(res.status).toBe(404);
    }

    const twentyFirst = await GET(getRequest('unknown-token', ip), {
      params: Promise.resolve({ token: 'unknown-token' }),
    });

    expect(twentyFirst.status).toBe(429);
    expect(twentyFirst.headers.get('Retry-After')).toBeTruthy();
  });
});
