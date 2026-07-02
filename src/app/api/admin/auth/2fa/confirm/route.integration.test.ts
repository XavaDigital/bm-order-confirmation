import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { generateSync } from 'otplib';
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
import { generateTotpSecret } from '@/server/auth/totp';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  const session = (await getSession()) as unknown as Record<string, unknown>;
  for (const key of Object.keys(session)) delete session[key];
});

async function seedStaff(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [staff] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'confirm@example.com',
      passwordHash: 'unused',
      name: 'Confirm Staff',
      ...overrides,
    })
    .returning();
  return staff;
}

async function setSession(userId: string) {
  const session = (await getSession()) as unknown as Record<string, unknown>;
  session.userId = userId;
}

function confirmRequest(code: string) {
  return new NextRequest('http://localhost/api/admin/auth/2fa/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/admin/auth/2fa/confirm', () => {
  it('returns 401 when there is no session', async () => {
    const res = await POST(confirmRequest('123456'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for a malformed code', async () => {
    const staff = await seedStaff();
    await setSession(staff.id);
    const res = await POST(confirmRequest('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when there is no pending secret from /setup', async () => {
    const staff = await seedStaff();
    await setSession(staff.id);
    const res = await POST(confirmRequest('123456'));
    expect(res.status).toBe(400);
  });

  it('returns 401 for an incorrect code', async () => {
    const secret = generateTotpSecret();
    const staff = await seedStaff({ totpSecret: secret });
    await setSession(staff.id);
    const res = await POST(confirmRequest('000000'));
    expect(res.status).toBe(401);
  });

  it('enables 2FA and returns 8 backup codes for a valid code', async () => {
    const secret = generateTotpSecret();
    const staff = await seedStaff({ totpSecret: secret });
    await setSession(staff.id);

    const code = generateSync({ secret });
    const res = await POST(confirmRequest(code));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.backupCodes).toHaveLength(8);

    const [updated] = await db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.id, staff.id));
    expect(updated.totpEnabled).toBe(true);
    expect((updated.totpBackupCodes as string[]).length).toBe(8);
  });
});
