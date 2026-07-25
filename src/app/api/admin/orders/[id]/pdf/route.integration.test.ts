import { afterEach, describe, expect, it, vi } from 'vitest';
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
      if (prop === 'destroy') return () => { for (const k of Object.keys(target)) delete target[k]; };
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
      if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession() {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.email = 'staff@example.com';
}

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey', sizing: [{ size: 'M', playerName: 'Alice' }] }],
    ...overrides,
  });
}

function getRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/pdf');
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('GET /api/admin/orders/[id]/pdf', () => {
  it('returns 401 when there is no session', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await GET(getRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown order id', async () => {
    await setSession();

    const res = await GET(getRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });

    expect(res.status).toBe(404);
  });

  it('returns 200 with a PDF content-type and attachment filename', async () => {
    await setSession();
    const created = await createOrder(minimalOrderInput());

    const res = await GET(getRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(`${created.orderNumber}.pdf`);

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
