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

const { sendRosterLinkEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendRosterLinkEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/email', () => ({ sendRosterLinkEmail, isEmailConfigured }));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  sendRosterLinkEmail.mockClear();
  isEmailConfigured.mockReturnValue(true);
});

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.email = 'staff@example.com';
});

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com', clubName: 'Eastbourne Eagles' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

function postRequest() {
  return new NextRequest('http://localhost/api/admin/orders/x/roster/send-link', { method: 'POST' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/roster/send-link', () => {
  it('returns 503 when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(503);
    expect(sendRosterLinkEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown order id', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('generates a roster link, emails it to the customer, and returns the url', async () => {
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, url: expect.any(String) });
    expect(sendRosterLinkEmail).toHaveBeenCalledTimes(1);
    expect(sendRosterLinkEmail.mock.calls[0][0]).toMatchObject({
      to: 'jane@example.com',
      toName: 'Jane Coach',
      clubName: 'Eastbourne Eagles',
      url: json.url,
    });
  });

  it('records a roster.link_emailed audit event', async () => {
    const created = await createOrder(minimalOrderInput());

    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    const events = await db.query.domainEvents.findMany({ where: eq(schema.domainEvents.aggregateId, created.orderId) });
    expect(events.some((e) => e.eventType === 'roster.link_emailed')).toBe(true);
  });

  it('returns 500 with the underlying message when sendRosterLinkEmail throws', async () => {
    sendRosterLinkEmail.mockRejectedValueOnce(new Error('SMTP exploded'));
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('SMTP exploded');
  });
});
