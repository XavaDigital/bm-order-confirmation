import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

const { sendPasswordResetEmail, isEmailConfigured } = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  isEmailConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/email', () => ({ sendPasswordResetEmail, isEmailConfigured }));

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { hashPassword } from '@/lib/password';
import { POST } from './route';

afterEach(async () => {
  await resetTestDb(db);
  sendPasswordResetEmail.mockClear();
  isEmailConfigured.mockReturnValue(false);
});

async function seedActiveUser(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const passwordHash = await hashPassword('correct-horse-battery-staple');
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

function forgotRequest(body: unknown, ip = '10.0.0.1') {
  return new NextRequest('http://localhost/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

describe('POST /api/auth/forgot-password', () => {
  it('returns 400 for a malformed email', async () => {
    const res = await POST(forgotRequest({ email: 'not-an-email' }, '10.0.1.1'));
    expect(res.status).toBe(400);
  });

  it('returns the same 200 generic response for a known email', async () => {
    await seedActiveUser();
    const res = await POST(forgotRequest({ email: 'staff@example.com' }, '10.0.1.2'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('returns the same 200 generic response for an unknown email', async () => {
    const res = await POST(forgotRequest({ email: 'nobody@example.com' }, '10.0.1.3'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('does not set a reset token for an unknown email', async () => {
    await POST(forgotRequest({ email: 'nobody@example.com' }, '10.0.1.4'));
    const user = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.email, 'nobody@example.com') });
    expect(user).toBeUndefined();
  });

  it('sets a reset token for a known active user and sends email when configured', async () => {
    const user = await seedActiveUser();
    isEmailConfigured.mockReturnValue(true);

    await POST(forgotRequest({ email: 'staff@example.com' }, '10.0.1.5'));

    const updated = await db.query.staffUsers.findFirst({ where: eq(schema.staffUsers.id, user.id) });
    expect(updated!.resetTokenHash).not.toBeNull();
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail.mock.calls[0][0]).toMatchObject({ to: 'staff@example.com' });
  });

  it('does not send an email when email is not configured', async () => {
    await seedActiveUser();
    isEmailConfigured.mockReturnValue(false);

    await POST(forgotRequest({ email: 'staff@example.com' }, '10.0.1.6'));

    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('rate limits after 5 attempts from the same IP', async () => {
    const ip = '10.0.2.1';
    for (let i = 0; i < 5; i++) {
      const res = await POST(forgotRequest({ email: `user${i}@example.com` }, ip));
      expect(res.status).toBe(200);
    }
    const sixth = await POST(forgotRequest({ email: 'user5@example.com' }, ip));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).not.toBeNull();
  });

  it('rate limits after 5 attempts for the same email across different IPs', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(forgotRequest({ email: 'same@example.com' }, `10.0.3.${i}`));
      expect(res.status).toBe(200);
    }
    const sixth = await POST(forgotRequest({ email: 'same@example.com' }, '10.0.3.99'));
    expect(sixth.status).toBe(429);
  });
});
