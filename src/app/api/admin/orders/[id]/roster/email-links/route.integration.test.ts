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

const { sendRosterMemberLinkEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendRosterMemberLinkEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/email', () => ({ sendRosterMemberLinkEmail, isEmailConfigured }));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { addRosterMember } from '@/server/roster/service';
import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  sendRosterMemberLinkEmail.mockClear();
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
  return new NextRequest('http://localhost/api/admin/orders/x/roster/email-links', { method: 'POST' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/roster/email-links', () => {
  it('returns 503 when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const created = await createOrder(minimalOrderInput());

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    expect(res.status).toBe(503);
    expect(sendRosterMemberLinkEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown order', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('emails only members with an email on file and reports counts', async () => {
    const created = await createOrder(minimalOrderInput());
    await addRosterMember(created.orderId, { name: 'Alex', email: 'alex@example.com' });
    await addRosterMember(created.orderId, { name: 'Sam', email: 'sam@example.com' });
    await addRosterMember(created.orderId, { name: 'Jo' }); // no email

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ sent: 2, skippedNoEmail: 1, total: 3 });
    expect(sendRosterMemberLinkEmail).toHaveBeenCalledTimes(2);
    expect(sendRosterMemberLinkEmail.mock.calls.map((c) => c[0].to).sort()).toEqual([
      'alex@example.com',
      'sam@example.com',
    ]);
  });

  it('records a roster.member_link_emailed audit event per member emailed', async () => {
    const created = await createOrder(minimalOrderInput());
    await addRosterMember(created.orderId, { name: 'Alex', email: 'alex@example.com' });

    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });

    const events = await db.query.domainEvents.findMany({ where: eq(schema.domainEvents.aggregateId, created.orderId) });
    expect(events.filter((e) => e.eventType === 'roster.member_link_emailed')).toHaveLength(1);
  });

  it('returns sent:0 when no members have an email on file', async () => {
    const created = await createOrder(minimalOrderInput());
    await addRosterMember(created.orderId, { name: 'Jo' });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ sent: 0, skippedNoEmail: 1, total: 1 });
  });
});
