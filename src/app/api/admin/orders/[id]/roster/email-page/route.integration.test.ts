import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const { sendRosterPageEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendRosterPageEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/email', () => ({ sendRosterPageEmail, isEmailConfigured }));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder, setRosterPage } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  sendRosterPageEmail.mockClear();
  isEmailConfigured.mockReturnValue(true);
});

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.role = 'sales';
  session.email = 'staff@example.com';
});

function minimalOrderInput() {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com', clubName: 'Eastbourne Eagles' },
    garments: [{ name: 'Home Jersey' }],
  });
}

function postRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/roster/email-page', { method: 'POST' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/roster/email-page', () => {
  it('returns 503 when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(503);
    expect(sendRosterPageEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown order id', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 409 when the roster page is not enabled', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(409);
    expect(sendRosterPageEmail).not.toHaveBeenCalled();
  });

  it('emails the page url and team password to the customer', async () => {
    const created = await createOrder(minimalOrderInput());
    const page = await setRosterPage(created.orderId, { enabled: true });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, url: page.url });
    expect(sendRosterPageEmail).toHaveBeenCalledTimes(1);
    expect(sendRosterPageEmail.mock.calls[0][0]).toMatchObject({
      to: 'jane@example.com',
      toName: 'Jane Coach',
      clubName: 'Eastbourne Eagles',
      url: page.url,
      // First enable mints a default password — the email must carry it.
      password: page.password,
    });
    expect(page.password).not.toBeNull();
  });

  it('records a roster.page_emailed audit event', async () => {
    const created = await createOrder(minimalOrderInput());
    await setRosterPage(created.orderId, { enabled: true });

    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    const events = await db.query.auditEvents.findMany({ where: eq(schema.auditEvents.aggregateId, created.orderId) });
    expect(events.some((e) => e.eventType === 'roster.page_emailed')).toBe(true);
  });
});
