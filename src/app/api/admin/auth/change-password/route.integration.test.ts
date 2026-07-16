import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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
      if (prop === 'destroy') {
        return () => {
          for (const k of Object.keys(target)) delete target[k];
        };
      }
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
import * as schema from '@/db/schema';
import { getSession } from '@/lib/session';
import { hashPassword, verifyPassword } from '@/lib/password';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedStaff(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const passwordHash = await hashPassword('correct-horse');
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'staff@example.com',
      passwordHash,
      name: 'Staff Person',
      ...overrides,
    })
    .returning();
  return staff;
}

async function setSession(userId: string) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
}

function changePasswordRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/admin/auth/change-password', () => {
  it('returns 401 when there is no session', async () => {
    const res = await POST(changePasswordRequest({ currentPassword: 'x', newPassword: 'a-long-password' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the new password is too short', async () => {
    const staff = await seedStaff();
    await setSession(staff.id);
    const res = await POST(changePasswordRequest({ currentPassword: 'correct-horse', newPassword: 'short' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the session user no longer exists', async () => {
    await setSession('00000000-0000-0000-0000-000000000000');
    const res = await POST(changePasswordRequest({ currentPassword: 'x', newPassword: 'a-long-password' }));
    expect(res.status).toBe(404);
  });

  it('returns 401 for an incorrect current password', async () => {
    const staff = await seedStaff();
    await setSession(staff.id);
    const res = await POST(changePasswordRequest({ currentPassword: 'wrong', newPassword: 'a-long-password' }));
    expect(res.status).toBe(401);
  });

  it('updates the password for the correct current password', async () => {
    const staff = await seedStaff();
    await setSession(staff.id);

    const res = await POST(
      changePasswordRequest({ currentPassword: 'correct-horse', newPassword: 'brand-new-password-123' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const [updated] = await db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, staff.id));
    expect(await verifyPassword('brand-new-password-123', updated.passwordHash)).toBe(true);
    expect(await verifyPassword('correct-horse', updated.passwordHash)).toBe(false);
  });
});
