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

const { sendInviteEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/email', () => ({ sendInviteEmail, isEmailConfigured }));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { GET, POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
  sendInviteEmail.mockClear();
  isEmailConfigured.mockReturnValue(false);
});

async function setSession(role: 'sales' | 'admin', overrides: Record<string, unknown> = {}) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = 'staff-1';
  session.email = 'staff@example.com';
  session.name = 'Staff One';
  session.role = role;
  Object.assign(session, overrides);
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('GET /api/admin/users', () => {
  it('returns 401 when there is no session', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 403 for a sales-role session', async () => {
    await setSession('sales');
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns 200 with the user list, flagging pending invites', async () => {
    await setSession('admin');
    await db.insert(schema.staffUsers).values([
      { email: 'active@example.com', passwordHash: 'x', name: 'Active', role: 'sales' },
      { email: 'pending@example.com', passwordHash: 'x', name: 'Pending', role: 'sales', inviteTokenHash: 'hash', isActive: false },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveLength(2);
    const pending = json.find((u: { email: string }) => u.email === 'pending@example.com');
    expect(pending.isPending).toBe(true);
    const active = json.find((u: { email: string }) => u.email === 'active@example.com');
    expect(active.isPending).toBe(false);
  });
});

describe('POST /api/admin/users', () => {
  it('returns 401 when there is no session', async () => {
    const res = await POST(postRequest({ name: 'A', email: 'a@example.com', role: 'sales' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a sales-role session', async () => {
    await setSession('sales');
    const res = await POST(postRequest({ name: 'A', email: 'a@example.com', role: 'sales' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 with details for an invalid body', async () => {
    await setSession('admin');
    const res = await POST(postRequest({ name: '', email: 'not-an-email', role: 'sales' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 409 when the email already exists', async () => {
    await setSession('admin');
    await db.insert(schema.staffUsers).values({ email: 'a@example.com', passwordHash: 'x', name: 'A', role: 'sales' });

    const res = await POST(postRequest({ name: 'A', email: 'a@example.com', role: 'sales' }));
    expect(res.status).toBe(409);
  });

  it('returns 201 with the setupUrl when email is not configured, and does not send an email', async () => {
    await setSession('admin');
    const res = await POST(postRequest({ name: 'New Person', email: 'new@example.com', role: 'sales' }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.setupUrl).toContain('/accept-invite?token=');
    expect(sendInviteEmail).not.toHaveBeenCalled();

    const row = await db.query.staffUsers.findFirst({ where: (u, { eq }) => eq(u.email, 'new@example.com') });
    expect(row).toBeDefined();
    expect(row!.isActive).toBe(false);
  });

  it('returns 201 without the setupUrl and sends an email when email is configured', async () => {
    isEmailConfigured.mockReturnValue(true);
    await setSession('admin');
    const res = await POST(postRequest({ name: 'New Person', email: 'new2@example.com', role: 'admin' }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.setupUrl).toBeUndefined();
    expect(sendInviteEmail).toHaveBeenCalledTimes(1);
    expect(sendInviteEmail.mock.calls[0][0]).toMatchObject({
      to: 'new2@example.com',
      role: 'admin',
      inviterName: 'Staff One',
    });
  });
});
