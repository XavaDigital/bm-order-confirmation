import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { GET } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedStaff(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'status@example.com',
      passwordHash: 'unused',
      name: 'Status Staff',
      ...overrides,
    })
    .returning();
  return staff;
}

async function setSession(userId: string) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
}

describe('GET /api/admin/auth/2fa/status', () => {
  it('returns 401 when there is no session', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 404 when the session user no longer exists', async () => {
    await setSession('00000000-0000-0000-0000-000000000000');
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('reports disabled with zero backup codes for a fresh account', async () => {
    const staff = await seedStaff();
    await setSession(staff.id);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, backupCodesRemaining: 0 });
  });

  it('reports enabled with the correct remaining backup code count', async () => {
    const staff = await seedStaff({
      totpEnabled: true,
      totpSecret: 'ABC',
      totpBackupCodes: ['h1', 'h2', 'h3'],
    });
    await setSession(staff.id);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, backupCodesRemaining: 3 });
  });
});
