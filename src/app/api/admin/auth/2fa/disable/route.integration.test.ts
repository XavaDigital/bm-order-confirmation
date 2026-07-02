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
import { hashPassword } from '@/lib/password';
import { DELETE } from './route';

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
      email: 'disable@example.com',
      passwordHash,
      name: 'Disable Staff',
      ...overrides,
    })
    .returning();
  return staff;
}

async function setSession(userId: string) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
}

function disableRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/auth/2fa/disable', {
    method: 'DELETE',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('DELETE /api/admin/auth/2fa/disable', () => {
  it('returns 401 when there is no session', async () => {
    const res = await DELETE(disableRequest({ password: 'x' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the password field is missing', async () => {
    const staff = await seedStaff({ totpEnabled: true, totpSecret: 'ABC' });
    await setSession(staff.id);
    const res = await DELETE(disableRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the session user no longer exists', async () => {
    await setSession('00000000-0000-0000-0000-000000000000');
    const res = await DELETE(disableRequest({ password: 'x' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when 2FA is not currently enabled', async () => {
    const staff = await seedStaff({ totpEnabled: false });
    await setSession(staff.id);
    const res = await DELETE(disableRequest({ password: 'correct-horse' }));
    expect(res.status).toBe(400);
  });

  it('returns 401 for an incorrect password', async () => {
    const staff = await seedStaff({ totpEnabled: true, totpSecret: 'ABC' });
    await setSession(staff.id);
    const res = await DELETE(disableRequest({ password: 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('disables 2FA and clears secret/backup codes for the correct password', async () => {
    const staff = await seedStaff({
      totpEnabled: true,
      totpSecret: 'ABC',
      totpBackupCodes: ['hash1', 'hash2'],
    });
    await setSession(staff.id);

    const res = await DELETE(disableRequest({ password: 'correct-horse' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const [updated] = await db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.id, staff.id));
    expect(updated.totpEnabled).toBe(false);
    expect(updated.totpSecret).toBeNull();
    expect(updated.totpBackupCodes).toBeNull();
  });
});
