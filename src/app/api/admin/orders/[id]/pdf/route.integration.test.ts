import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

const { getIronSession } = vi.hoisted(() => ({ getIronSession: vi.fn() }));

vi.mock('iron-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('iron-session')>();
  return { ...actual, getIronSession };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({})),
}));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
  getIronSession.mockReset();
});

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
    getIronSession.mockResolvedValue({});
    const created = await createOrder(minimalOrderInput());

    const res = await GET(getRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown order id', async () => {
    getIronSession.mockResolvedValue({ userId: 'staff-1' });

    const res = await GET(getRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });

    expect(res.status).toBe(404);
  });

  it('returns 200 with a PDF content-type and attachment filename', async () => {
    getIronSession.mockResolvedValue({ userId: 'staff-1' });
    const created = await createOrder(minimalOrderInput());

    const res = await GET(getRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(`${created.orderNumber}.pdf`);

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
