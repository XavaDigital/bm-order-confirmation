import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, and, count } from 'drizzle-orm';

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
import { hashToken } from '@/lib/tokens';
import {
  listStaffUsers,
  inviteUser,
  acceptInvite,
  updateUser,
  deleteUser,
  UserNotFoundError,
  UserConflictError,
  LastAdminError,
  InviteExpiredError,
} from './service';

afterEach(async () => {
  await resetTestDb(db);
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

async function seedPendingUser(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'invitee@example.com',
      passwordHash: '$2b$12$invitedplaceholderhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      name: 'Invitee Person',
      role: 'sales',
      isActive: false,
      inviteTokenHash: hashToken('some-raw-token'),
      inviteTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      ...overrides,
    })
    .returning();
  return user;
}

describe('listStaffUsers', () => {
  it('flags isPending true iff inviteTokenHash is non-null, newest-first', async () => {
    const active = await seedActiveUser({ email: 'active@example.com', createdAt: new Date(Date.now() - 1000) });
    const pending = await seedPendingUser({ email: 'pending@example.com', createdAt: new Date() });

    const users = await listStaffUsers();

    expect(users).toHaveLength(2);
    expect(users[0].id).toBe(pending.id);
    expect(users[0].isPending).toBe(true);
    expect(users[1].id).toBe(active.id);
    expect(users[1].isPending).toBe(false);
  });
});

describe('inviteUser', () => {
  it('creates an inactive user with a placeholder hash, token hash, and ~72h expiry', async () => {
    const before = Date.now();
    const { rawToken, setupUrl } = await inviteUser('New Person', 'new@example.com', 'sales');
    const after = Date.now();

    expect(rawToken).toBeTruthy();
    expect(setupUrl).toContain(rawToken);

    const user = await db.query.staffUsers.findFirst({
      where: eq(schema.staffUsers.email, 'new@example.com'),
    });
    expect(user).toBeDefined();
    expect(user!.isActive).toBe(false);
    expect(user!.passwordHash).toBe('$2b$12$invitedplaceholderhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    expect(user!.inviteTokenHash).toBe(hashToken(rawToken));

    const expiresAtMs = user!.inviteTokenExpiresAt!.getTime();
    const seventyTwoHoursMs = 72 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + seventyTwoHoursMs - 5000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + seventyTwoHoursMs + 5000);
  });

  it('throws UserConflictError on a duplicate email (case-insensitive)', async () => {
    await seedActiveUser({ email: 'dup@example.com' });

    await expect(inviteUser('Dup Person', 'DUP@Example.com', 'sales')).rejects.toThrow(
      UserConflictError,
    );
  });
});

describe('acceptInvite', () => {
  it('happy path: activates, sets a real password hash, clears invite fields', async () => {
    const pending = await seedPendingUser({ inviteTokenHash: hashToken('valid-raw-token') });

    await acceptInvite('valid-raw-token', 'new-password-123');

    const updated = await db.query.staffUsers.findFirst({
      where: eq(schema.staffUsers.id, pending.id),
    });
    expect(updated!.isActive).toBe(true);
    expect(updated!.inviteTokenHash).toBeNull();
    expect(updated!.inviteTokenExpiresAt).toBeNull();
    expect(updated!.passwordHash).not.toBe('$2b$12$invitedplaceholderhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
  });

  it('throws InviteExpiredError for an unknown token', async () => {
    await expect(acceptInvite('unknown-token', 'new-password-123')).rejects.toThrow(
      InviteExpiredError,
    );
  });

  it('throws InviteExpiredError for an expired token', async () => {
    await seedPendingUser({
      inviteTokenHash: hashToken('expired-raw-token'),
      inviteTokenExpiresAt: new Date(Date.now() - 1000),
    });

    await expect(acceptInvite('expired-raw-token', 'new-password-123')).rejects.toThrow(
      InviteExpiredError,
    );
  });
});

describe('updateUser', () => {
  it('throws LastAdminError when demoting the sole active admin to sales', async () => {
    const admin = await seedActiveUser({ email: 'admin@example.com', role: 'admin' });

    await expect(updateUser(admin.id, { role: 'sales' })).rejects.toThrow(LastAdminError);
  });

  it('throws LastAdminError when deactivating the sole active admin', async () => {
    const admin = await seedActiveUser({ email: 'admin@example.com', role: 'admin' });

    await expect(updateUser(admin.id, { isActive: false })).rejects.toThrow(LastAdminError);
  });

  it('allows demoting or deactivating an admin when a second active admin exists', async () => {
    const admin1 = await seedActiveUser({ email: 'admin1@example.com', role: 'admin' });
    await seedActiveUser({ email: 'admin2@example.com', role: 'admin' });

    const demoted = await updateUser(admin1.id, { role: 'sales' });
    expect(demoted.role).toBe('sales');

    const admin1b = await seedActiveUser({ email: 'admin1b@example.com', role: 'admin' });
    const deactivated = await updateUser(admin1b.id, { isActive: false });
    expect(deactivated.isActive).toBe(false);
  });

  it('never fires the LastAdminError guard for a sales-role user being deactivated', async () => {
    const sales = await seedActiveUser({ email: 'sales@example.com', role: 'sales' });

    const result = await updateUser(sales.id, { isActive: false });
    expect(result.isActive).toBe(false);
  });

  it('throws UserNotFoundError for an unknown id', async () => {
    await expect(
      updateUser('00000000-0000-0000-0000-000000000000', { role: 'sales' }),
    ).rejects.toThrow(UserNotFoundError);
  });

  it('never lets two concurrent demotions leave zero active admins', async () => {
    const admin1 = await seedActiveUser({ email: 'admin1@example.com', role: 'admin' });
    const admin2 = await seedActiveUser({ email: 'admin2@example.com', role: 'admin' });

    const results = await Promise.allSettled([
      updateUser(admin1.id, { role: 'sales' }),
      updateUser(admin2.id, { role: 'sales' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LastAdminError);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.role, 'admin'), eq(schema.staffUsers.isActive, true)));
    expect(Number(total)).toBe(1);
  });
});

describe('deleteUser', () => {
  it('succeeds for a pending (invited, inactive) user', async () => {
    const pending = await seedPendingUser();

    await deleteUser(pending.id);

    const found = await db.query.staffUsers.findFirst({
      where: eq(schema.staffUsers.id, pending.id),
    });
    expect(found).toBeUndefined();
  });

  it('throws a plain Error (not one of the named classes) for an active user', async () => {
    const active = await seedActiveUser();

    let caught: unknown;
    try {
      await deleteUser(active.id);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(UserNotFoundError);
    expect(caught).not.toBeInstanceOf(UserConflictError);
    expect(caught).not.toBeInstanceOf(LastAdminError);
    expect(caught).not.toBeInstanceOf(InviteExpiredError);
    expect((caught as Error).name).toBe('Error');
  });

  it('throws UserNotFoundError for an unknown id', async () => {
    await expect(deleteUser('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      UserNotFoundError,
    );
  });
});
