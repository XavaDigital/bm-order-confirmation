import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';

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
      if (prop === 'destroy')
        return () => {
          for (const k of Object.keys(target)) delete target[k];
        };
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
      if (!session.userId)
        return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
      if (session.role !== 'admin')
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
      return { session };
    }),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { GET, POST, DELETE } from './route';

const NO_PARAMS = { params: Promise.resolve({} as Record<string, never>) };
const STAFF_1_ID = '11111111-1111-1111-1111-111111111111';
const STAFF_2_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(async () => {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = STAFF_1_ID;
  session.role = 'sales';
  session.email = 'sam@x.com';
});

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey' }],
    }),
  );
  return created.orderId;
}

async function seedStaff(id: string, email: string) {
  await db.insert(schema.staffUsers).values({ id, email, name: 'Sam', passwordHash: 'x', role: 'sales' });
}

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/admin/workflow/status-reminders${query}`);
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/workflow/status-reminders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/workflow/status-reminders', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/workflow/status-reminders', () => {
  it('creates a reminder for a valid order status', async () => {
    const orderId = await seedOrder();
    await seedStaff(STAFF_1_ID, 'sam@x.com');

    const res = await POST(
      postRequest({ boardKey: 'order', entityId: orderId, triggerStatus: 'confirmed', note: 'ping' }),
      NO_PARAMS,
    );

    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.workflowStatusReminders)
      .where(eq(schema.workflowStatusReminders.entityId, orderId));
    expect(row.triggerStatus).toBe('confirmed');
    expect(row.createdByStaffUserId).toBe(STAFF_1_ID);
  });

  it('rejects a status that does not belong to the board', async () => {
    const orderId = await seedOrder();
    await seedStaff(STAFF_1_ID, 'sam@x.com');

    // 'test_print' is a PO status, not an order status.
    const res = await POST(
      postRequest({ boardKey: 'order', entityId: orderId, triggerStatus: 'test_print', note: 'ping' }),
      NO_PARAMS,
    );

    expect(res.status).toBe(400);
  });

  it('401s when not signed in', async () => {
    const session = (await getSession()) as unknown as Record<string, unknown>;
    for (const key of Object.keys(session)) delete session[key];
    const orderId = await seedOrder();

    const res = await POST(
      postRequest({ boardKey: 'order', entityId: orderId, triggerStatus: 'confirmed', note: 'ping' }),
      NO_PARAMS,
    );

    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/workflow/status-reminders', () => {
  it('lists reminders for the entity', async () => {
    const orderId = await seedOrder();
    await seedStaff(STAFF_1_ID, 'sam@x.com');
    await POST(
      postRequest({ boardKey: 'order', entityId: orderId, triggerStatus: 'confirmed', note: 'ping' }),
      NO_PARAMS,
    );

    const res = await GET(getRequest(`?boardKey=order&entityId=${orderId}`), NO_PARAMS);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0].note).toBe('ping');
  });
});

describe('DELETE /api/admin/workflow/status-reminders', () => {
  it('lets the creator cancel their own reminder', async () => {
    const orderId = await seedOrder();
    await seedStaff(STAFF_1_ID, 'sam@x.com');
    const created = await (
      await POST(
        postRequest({ boardKey: 'order', entityId: orderId, triggerStatus: 'confirmed', note: 'ping' }),
        NO_PARAMS,
      )
    ).json();

    const res = await DELETE(deleteRequest({ id: created.id }), NO_PARAMS);

    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.workflowStatusReminders)
      .where(eq(schema.workflowStatusReminders.id, created.id));
    expect(row.resolvedAt).not.toBeNull();
  });

  it('409s a non-creator, non-admin trying to cancel', async () => {
    const orderId = await seedOrder();
    await seedStaff(STAFF_1_ID, 'sam@x.com');
    const created = await (
      await POST(
        postRequest({ boardKey: 'order', entityId: orderId, triggerStatus: 'confirmed', note: 'ping' }),
        NO_PARAMS,
      )
    ).json();

    const session = (await getSession()) as unknown as Record<string, unknown>;
    session.userId = STAFF_2_ID;
    await seedStaff(STAFF_2_ID, 'other@x.com');

    const res = await DELETE(deleteRequest({ id: created.id }), NO_PARAMS);

    expect(res.status).toBe(409);
  });
});
