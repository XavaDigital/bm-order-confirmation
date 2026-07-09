import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { hashPassword } from '@/lib/password';
import { loginStaff, AuthError } from './service';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedStaffUser(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const passwordHash = await hashPassword('correct-horse-battery-staple');
  const [user] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'staff@example.com',
      passwordHash,
      name: 'Staff Person',
      role: 'sales',
      isActive: true,
      totpEnabled: false,
      ...overrides,
    })
    .returning();
  return user;
}

describe('loginStaff', () => {
  it('returns an AuthUser with requiresMfa=false when totp is disabled', async () => {
    await seedStaffUser({ totpEnabled: false });

    const result = await loginStaff('staff@example.com', 'correct-horse-battery-staple');

    expect(result.email).toBe('staff@example.com');
    expect(result.name).toBe('Staff Person');
    expect(result.role).toBe('sales');
    expect(result.requiresMfa).toBe(false);
  });

  it('returns an AuthUser with requiresMfa=true when totp is enabled', async () => {
    await seedStaffUser({ totpEnabled: true, totpSecret: 'SECRET' });

    const result = await loginStaff('staff@example.com', 'correct-horse-battery-staple');

    expect(result.requiresMfa).toBe(true);
  });

  it('throws AuthError for a wrong password', async () => {
    await seedStaffUser();

    await expect(loginStaff('staff@example.com', 'wrong-password')).rejects.toThrow(AuthError);
  });

  it('throws AuthError for an unknown email, with the same message as a wrong password', async () => {
    await seedStaffUser();

    let unknownMessage = '';
    let wrongPasswordMessage = '';
    try {
      await loginStaff('nobody@example.com', 'whatever');
    } catch (err) {
      unknownMessage = (err as Error).message;
    }
    try {
      await loginStaff('staff@example.com', 'wrong-password');
    } catch (err) {
      wrongPasswordMessage = (err as Error).message;
    }

    expect(unknownMessage).toBe(wrongPasswordMessage);
    expect(unknownMessage).toBeTruthy();
  });

  it('throws AuthError when the user is inactive, even with the correct password', async () => {
    await seedStaffUser({ isActive: false });

    await expect(
      loginStaff('staff@example.com', 'correct-horse-battery-staple'),
    ).rejects.toThrow(AuthError);
  });

  it('looks up the email case-insensitively', async () => {
    await seedStaffUser({ email: 'staff@example.com' });

    const result = await loginStaff('STAFF@Example.com', 'correct-horse-battery-staple');

    expect(result.email).toBe('staff@example.com');
  });

  it('stamps lastLoginAt on a successful login', async () => {
    const user = await seedStaffUser();
    expect(user.lastLoginAt).toBeNull();

    const before = new Date();
    await loginStaff('staff@example.com', 'correct-horse-battery-staple');

    const updated = await db.query.staffUsers.findFirst({
      where: eq(schema.staffUsers.id, user.id),
    });
    expect(updated?.lastLoginAt).toBeInstanceOf(Date);
    expect(updated!.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('does not stamp lastLoginAt on a failed login', async () => {
    const user = await seedStaffUser();

    await expect(loginStaff('staff@example.com', 'wrong-password')).rejects.toThrow(AuthError);

    const unchanged = await db.query.staffUsers.findFirst({
      where: eq(schema.staffUsers.id, user.id),
    });
    expect(unchanged?.lastLoginAt).toBeNull();
  });
});
