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
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function getRequest(query = '') {
  return new NextRequest(`http://localhost/api/admin/orders/export${query}`);
}

describe('GET /api/admin/orders/export', () => {
  it('returns 401 when not authenticated', async () => {
    const session = (await getSession()) as unknown as Record<string, unknown>;
    delete session.userId;

    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it('returns a CSV attachment with a header row and one row per order', async () => {
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.userId = 'staff-1';

    await createOrder(minimalInput({ customer: { name: 'Jane Coach', email: 'jane@example.com', clubName: 'Wildcats' } }));
    await createOrder(minimalInput({ customer: { name: 'Bob Coach', email: 'bob@example.com' } }));

    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="orders-');

    const body = await res.text();
    const lines = body.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('Order Number,Customer Name,Customer Email,Club,Status,Value,Currency,Created At,Confirmed At');
    expect(lines).toHaveLength(3); // header + 2 orders
    expect(lines.some((l) => l.includes('Jane Coach') && l.includes('Wildcats'))).toBe(true);
    expect(lines.some((l) => l.includes('Bob Coach'))).toBe(true);
  });

  it('filters by status and search query params, same as the list endpoint', async () => {
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.userId = 'staff-1';

    await createOrder(minimalInput({ customer: { name: 'Alpha Club', email: 'a@example.com' } }));
    await createOrder(minimalInput({ customer: { name: 'Beta Club', email: 'b@example.com' } }));

    const res = await GET(getRequest('?search=beta'));
    const body = await res.text();
    const lines = body.replace(/^﻿/, '').split('\r\n');

    expect(lines).toHaveLength(2); // header + 1 match
    expect(lines[1]).toContain('Beta Club');
  });

  it('neutralizes a leading formula character in customer-supplied text', async () => {
    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.userId = 'staff-1';

    await createOrder(minimalInput({ customer: { name: '=cmd|/c calc', email: 'jane@example.com' } }));

    const res = await GET(getRequest());
    const body = await res.text();
    const lines = body.replace(/^﻿/, '').split('\r\n');

    expect(lines[1]).toContain("'=cmd|/c calc");
  });
});
