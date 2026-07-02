import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedStaff() {
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'setup@example.com',
      passwordHash: 'unused',
      name: 'Setup Staff',
    })
    .returning();
  return staff;
}

async function setSession(userId: string, email: string) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
  session.email = email;
}

describe('POST /api/admin/auth/2fa/setup', () => {
  it('returns 401 when there is no session', async () => {
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('generates and persists a pending secret without enabling 2FA', async () => {
    const staff = await seedStaff();
    await setSession(staff.id, staff.email);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.secret).toBe('string');
    expect(body.secret.length).toBeGreaterThan(0);
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const [updated] = await db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.id, staff.id));
    expect(updated.totpSecret).toBe(body.secret);
    expect(updated.totpEnabled).toBe(false);
  });
});
