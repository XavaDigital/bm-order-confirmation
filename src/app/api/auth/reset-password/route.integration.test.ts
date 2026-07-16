import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/password';
import { hashToken } from '@/lib/tokens';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedActiveUser(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const passwordHash = await hashPassword('old-password-123');
  const [user] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'staff@example.com',
      passwordHash,
      name: 'Staff Person',
      role: 'sales',
      isActive: true,
      ...overrides,
    })
    .returning();
  return user;
}

function resetRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/auth/reset-password', () => {
  it('returns 400 with details for an invalid body', async () => {
    const res = await POST(resetRequest({ token: '', password: 'short' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details).toBeDefined();
  });

  it('returns 410 for an unknown token', async () => {
    const res = await POST(resetRequest({ token: 'bogus-token', password: 'a-long-enough-password' }));
    expect(res.status).toBe(410);
  });

  it('returns 410 for an expired token', async () => {
    await seedActiveUser({
      resetTokenHash: hashToken('expired-raw-token'),
      resetTokenExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await POST(resetRequest({ token: 'expired-raw-token', password: 'a-long-enough-password' }));
    expect(res.status).toBe(410);
  });

  it('returns 200 and updates the password', async () => {
    const user = await seedActiveUser({
      resetTokenHash: hashToken('valid-raw-token'),
      resetTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    const res = await POST(resetRequest({ token: 'valid-raw-token', password: 'a-long-enough-password' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    const updated = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, user.id) });
    expect(updated!.resetTokenHash).toBeNull();
    expect(await verifyPassword('a-long-enough-password', updated!.passwordHash)).toBe(true);
    expect(await verifyPassword('old-password-123', updated!.passwordHash)).toBe(false);
  });

  it('returns 410 when the same reset token is redeemed twice', async () => {
    await seedActiveUser({
      resetTokenHash: hashToken('valid-raw-token'),
      resetTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    await POST(resetRequest({ token: 'valid-raw-token', password: 'a-long-enough-password' }));

    const res = await POST(resetRequest({ token: 'valid-raw-token', password: 'another-long-password' }));
    expect(res.status).toBe(410);
  });
});
