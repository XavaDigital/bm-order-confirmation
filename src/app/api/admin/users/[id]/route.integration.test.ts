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
import { PATCH, DELETE } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function setSession(userId: string, role: 'sales' | 'admin') {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
  session.email = 'staff@example.com';
  session.name = 'Staff One';
  session.role = role;
}

async function seedAdmin(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [admin] = await db
    .insert(schema.staffUsers)
    .values({ email: `admin-${Math.random()}@example.com`, passwordHash: 'x', name: 'Admin', role: 'admin', ...overrides })
    .returning();
  return admin;
}

async function seedPendingUser(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.staffUsers)
    .values({
      email: `pending-${Math.random()}@example.com`,
      passwordHash: 'x',
      name: 'Pending',
      role: 'sales',
      isActive: false,
      inviteTokenHash: 'hash',
      ...overrides,
    })
    .returning();
  return user;
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/users/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function deleteRequest() {
  return new NextRequest('http://localhost/api/admin/users/x', { method: 'DELETE' });
}

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

describe('PATCH /api/admin/users/[id]', () => {
  it('returns 401 when there is no session', async () => {
    const res = await PATCH(patchRequest({ role: 'admin' }), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a sales-role session', async () => {
    await setSession('staff-1', 'sales');
    const res = await PATCH(patchRequest({ role: 'admin' }), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 when an admin tries to modify their own role/status', async () => {
    const admin = await seedAdmin();
    await setSession(admin.id, 'admin');
    const res = await PATCH(patchRequest({ role: 'sales' }), { params: Promise.resolve({ id: admin.id }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 with details for an invalid body (neither field provided)', async () => {
    const admin = await seedAdmin();
    await setSession(admin.id, 'admin');
    const target = await seedPendingUser();

    const res = await PATCH(patchRequest({}), { params: Promise.resolve({ id: target.id }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 404 for an unknown target user', async () => {
    const admin = await seedAdmin();
    await setSession(admin.id, 'admin');
    const res = await PATCH(patchRequest({ role: 'admin' }), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 409 when demoting the sole remaining active admin', async () => {
    // Session is an admin per the (unbacked) session cookie, distinct from the one real
    // admin row in the DB, so the service's "last admin" count (based on DB rows) is 1.
    await setSession('00000000-0000-0000-0000-0000000000ff', 'admin');
    const soleAdmin = await seedAdmin();

    const res = await PATCH(patchRequest({ role: 'sales' }), { params: Promise.resolve({ id: soleAdmin.id }) });
    expect(res.status).toBe(409);
  });

  it('returns 200 with the updated user and persists it', async () => {
    const admin = await seedAdmin();
    await setSession(admin.id, 'admin');
    const target = await seedPendingUser();

    const res = await PATCH(patchRequest({ isActive: true }), { params: Promise.resolve({ id: target.id }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.isActive).toBe(true);

    const row = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, target.id) });
    expect(row!.isActive).toBe(true);
  });
});

describe('DELETE /api/admin/users/[id]', () => {
  it('returns 401 when there is no session', async () => {
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a sales-role session', async () => {
    await setSession('staff-1', 'sales');
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 when an admin tries to delete themselves', async () => {
    const admin = await seedAdmin();
    await setSession(admin.id, 'admin');
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: admin.id }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown target user', async () => {
    const admin = await seedAdmin();
    await setSession(admin.id, 'admin');
    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: UNKNOWN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 200 and removes a pending invited user', async () => {
    const admin = await seedAdmin();
    await setSession(admin.id, 'admin');
    const target = await seedPendingUser();

    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: target.id }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const row = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, target.id) });
    expect(row).toBeUndefined();
  });

  it('returns 500 with a message when trying to delete an already-active user', async () => {
    const admin = await seedAdmin();
    await setSession(admin.id, 'admin');
    const activeUser = await seedAdmin({ role: 'sales', isActive: true });

    const res = await DELETE(deleteRequest(), { params: Promise.resolve({ id: activeUser.id }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/pending invited users/);
  });
});
