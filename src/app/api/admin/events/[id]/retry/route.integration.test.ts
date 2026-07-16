import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession(role: 'sales' | 'admin') {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.email = 'staff@example.com';
  session.name = 'Staff One';
  session.role = role;
}

const FAKE_ORDER_ID = '11111111-1111-1111-1111-111111111111';

async function seedEvent(overrides: Partial<typeof schema.domainEvents.$inferInsert> = {}) {
  const [event] = await db
    .insert(schema.domainEvents)
    .values({
      aggregateType: 'order',
      aggregateId: FAKE_ORDER_ID,
      eventType: 'order.confirmed',
      payload: {},
      status: 'failed',
      attempts: 2,
      ...overrides,
    })
    .returning();
  return event;
}

function retryRequest() {
  return new NextRequest('http://localhost/api/admin/events/x/retry', { method: 'POST' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('POST /api/admin/events/[id]/retry', () => {
  it('returns 401 when there is no session', async () => {
    const event = await seedEvent();
    const res = await POST(retryRequest(), { params: Promise.resolve({ id: event.id }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a sales-role session', async () => {
    await setSession('sales');
    const event = await seedEvent();
    const res = await POST(retryRequest(), { params: Promise.resolve({ id: event.id }) });
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown id', async () => {
    await setSession('admin');
    const res = await POST(retryRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('resets a failed event to pending with a zeroed attempt counter', async () => {
    await setSession('admin');
    const event = await seedEvent({ status: 'failed', attempts: 3, nextAttemptAt: new Date(Date.now() + 999_999) });
    const res = await POST(retryRequest(), { params: Promise.resolve({ id: event.id }) });
    expect(res.status).toBe(200);

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(0);
    expect(row!.nextAttemptAt).toBeNull();
  });

  it('resets a dead event to pending too', async () => {
    await setSession('admin');
    const event = await seedEvent({ status: 'dead', attempts: 5 });
    const res = await POST(retryRequest(), { params: Promise.resolve({ id: event.id }) });
    expect(res.status).toBe(200);

    const row = await db.query.domainEvents.findFirst({ where: eq(schema.domainEvents.id, event.id) });
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(0);
  });

  it('returns 404 for an event that is not currently failed/dead', async () => {
    await setSession('admin');
    const event = await seedEvent({ status: 'delivered', deliveredAt: new Date() });
    const res = await POST(retryRequest(), { params: Promise.resolve({ id: event.id }) });
    expect(res.status).toBe(404);
  });
});
