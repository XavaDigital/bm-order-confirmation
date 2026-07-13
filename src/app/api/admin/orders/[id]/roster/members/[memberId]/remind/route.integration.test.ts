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

const { sendRosterReminderEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendRosterReminderEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/email', () => ({ sendRosterReminderEmail, isEmailConfigured }));

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
  sendRosterReminderEmail.mockClear();
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
  return new NextRequest('http://localhost/api/admin/orders/x/roster/members/y/remind', { method: 'POST' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/orders/[id]/roster/members/[memberId]/remind', () => {
  it('returns 503 when email is not configured', async () => {
    isEmailConfigured.mockReturnValue(false);
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex', email: 'alex@example.com' });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId, memberId: member.id }) });

    expect(res.status).toBe(503);
    expect(sendRosterReminderEmail).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown order id', async () => {
    const res = await POST(postRequest(), { params: Promise.resolve({ id: UNKNOWN_ID, memberId: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a member that does not belong to the order', async () => {
    const created = await createOrder(minimalOrderInput());
    const other = await createOrder(minimalOrderInput({ customer: { name: 'Other Coach', email: 'other@example.com' } }));
    const member = await addRosterMember(other.orderId, { name: 'Alex', email: 'alex@example.com' });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId, memberId: member.id }) });

    expect(res.status).toBe(404);
    expect(sendRosterReminderEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when the member has no email on file', async () => {
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex' });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId, memberId: member.id }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/no email/i);
    expect(sendRosterReminderEmail).not.toHaveBeenCalled();
  });

  it('generates a roster link, emails the member, and returns the url', async () => {
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex', email: 'alex@example.com' });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId, memberId: member.id }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, url: expect.any(String) });
    expect(sendRosterReminderEmail).toHaveBeenCalledTimes(1);
    expect(sendRosterReminderEmail.mock.calls[0][0]).toMatchObject({
      to: 'alex@example.com',
      toName: 'Alex',
      clubName: 'Eastbourne Eagles',
      url: json.url,
    });
  });

  it('records a roster.reminder_sent audit event', async () => {
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex', email: 'alex@example.com' });

    await POST(postRequest(), { params: Promise.resolve({ id: created.orderId, memberId: member.id }) });

    const events = await db.query.domainEvents.findMany({ where: eq(schema.domainEvents.aggregateId, created.orderId) });
    expect(events.some((e) => e.eventType === 'roster.reminder_sent')).toBe(true);
  });

  it('returns 500 with the underlying message when sendRosterReminderEmail throws', async () => {
    sendRosterReminderEmail.mockRejectedValueOnce(new Error('SMTP exploded'));
    const created = await createOrder(minimalOrderInput());
    const member = await addRosterMember(created.orderId, { name: 'Alex', email: 'alex@example.com' });

    const res = await POST(postRequest(), { params: Promise.resolve({ id: created.orderId, memberId: member.id }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('SMTP exploded');
  });
});
