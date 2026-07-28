import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/server/identity/client', async () => {
  const actual = await vi.importActual<typeof import('@/server/identity/client')>(
    '@/server/identity/client',
  );
  return { ...actual, googleLogin: vi.fn() };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { googleLogin } from '@/server/identity/client';
import { IdentityAuthError, loginWithIdentity } from './service';

afterEach(async () => {
  await resetTestDb(db);
});

beforeEach(() => {
  vi.mocked(googleLogin).mockReset();
});

function identityUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'sam@beastmode.co.nz',
    name: 'Sam Sales',
    disabled: false,
    avatarUrl: null,
    googleLinked: true,
    createdAt: '2026-01-01T00:00:00Z',
    grants: { 'bm-orders': { role: 'sales' } },
    ...overrides,
  };
}

function resolves(user = identityUser(), role = 'sales', provisioned = false) {
  vi.mocked(googleLogin).mockResolvedValue({
    user: user as never,
    provisioned,
    access: { granted: true, role },
  });
}

async function seedLocal(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'sam@beastmode.co.nz',
      name: 'Sam Sales',
      passwordHash: 'x',
      role: 'sales',
      ...overrides,
    })
    .returning();
  return row;
}

async function readLocal(id: string) {
  const [row] = await db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, id));
  return row;
}

/**
 * The bridge is tried in three steps and the ORDER matters: the durable link
 * first, then a verified email, then create.
 */
describe('loginWithIdentity — bridging', () => {
  it('finds an already-linked account by identity id', async () => {
    const local = await seedLocal({
      identityUserId: '11111111-1111-4111-8111-111111111111',
      email: 'old-address@beastmode.co.nz',
    });
    resolves();

    const user = await loginWithIdentity('credential');

    expect(user.id).toBe(local.id);
    // Only one account — it did not create a second from the new email.
    expect(await db.select().from(schema.staffUsers)).toHaveLength(1);
  });

  // The link is what survives someone changing their email address.
  it('prefers the identity link over a matching email', async () => {
    const linked = await seedLocal({
      identityUserId: '11111111-1111-4111-8111-111111111111',
      email: 'renamed@beastmode.co.nz',
    });
    await seedLocal({ email: 'sam@beastmode.co.nz' });
    resolves();

    const user = await loginWithIdentity('credential');

    expect(user.id).toBe(linked.id);
  });

  it('bridges an existing account by email and stamps the link', async () => {
    const local = await seedLocal();
    resolves();

    const user = await loginWithIdentity('credential');

    expect(user.id).toBe(local.id);
    expect((await readLocal(local.id)).identityUserId).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('matches an email case-insensitively', async () => {
    const local = await seedLocal({ email: 'sam@beastmode.co.nz' });
    resolves(identityUser({ email: 'SAM@Beastmode.co.NZ' }));

    const user = await loginWithIdentity('credential');

    expect(user.id).toBe(local.id);
  });

  it('creates an account when identity vouches for someone new', async () => {
    resolves(identityUser({ email: 'new@beastmode.co.nz', name: 'New Person' }));

    const user = await loginWithIdentity('credential');

    expect(user.email).toBe('new@beastmode.co.nz');
    const rows = await db.select().from(schema.staffUsers);
    expect(rows).toHaveLength(1);
    expect(rows[0].identityUserId).toBe('11111111-1111-4111-8111-111111111111');
  });

  // A created account must not become a way in through the password form.
  it('gives a created account an unusable password', async () => {
    resolves(identityUser({ email: 'new@beastmode.co.nz' }));
    await loginWithIdentity('credential');

    const [row] = await db.select().from(schema.staffUsers);
    const { verifyPassword } = await import('@/lib/password');
    expect(await verifyPassword('', row.passwordHash)).toBe(false);
    expect(await verifyPassword('password', row.passwordHash)).toBe(false);
  });

  it('stamps lastLoginAt', async () => {
    const local = await seedLocal();
    resolves();

    await loginWithIdentity('credential');

    expect((await readLocal(local.id)).lastLoginAt).not.toBeNull();
  });
});

describe('loginWithIdentity — roles', () => {
  it('takes the role from this app’s grant', async () => {
    const local = await seedLocal({ role: 'sales' });
    resolves(identityUser({ grants: { 'bm-orders': { role: 'admin' } } }), 'admin');

    const user = await loginWithIdentity('credential');

    expect(user.role).toBe('admin');
    expect((await readLocal(local.id)).role).toBe('admin');
  });

  it('ignores another app’s grant', async () => {
    const local = await seedLocal({ role: 'sales' });
    resolves(identityUser({ grants: { 'sales-hub': { role: 'admin' } } }), 'sales');

    const user = await loginWithIdentity('credential');

    expect(user.role).toBe('sales');
    expect((await readLocal(local.id)).role).toBe('sales');
  });

  /**
   * Fleet access contract: an unrecognised role is NO ACCESS, not the local role
   * and not a default. Identity said "granted" but not in words this app speaks,
   * so there is nothing safe to give them.
   */
  it('refuses a login whose role this app does not understand', async () => {
    await seedLocal({ role: 'admin' });
    resolves(identityUser({ grants: { 'bm-orders': { role: 'superuser' } } }), 'superuser');

    await expect(loginWithIdentity('credential')).rejects.toMatchObject({ reason: 'no_role' });
  });

  /**
   * The contract is explicit that downgrades apply immediately — there is no
   * "never demote" rule, because that would let a lowered grant keep its old
   * privileges until the person happened to sign out.
   */
  it('applies a LOWER role immediately', async () => {
    const local = await seedLocal({ role: 'admin' });
    resolves(identityUser({ grants: { 'bm-orders': { role: 'viewer' } } }), 'viewer');

    const user = await loginWithIdentity('credential');

    expect(user.role).toBe('viewer');
    expect((await readLocal(local.id)).role).toBe('viewer');
  });

  it('blocks a login for a user identity reports as disabled', async () => {
    await seedLocal();
    resolves(identityUser({ disabled: true }));

    await expect(loginWithIdentity('credential')).rejects.toMatchObject({ reason: 'disabled' });
  });

  it('updates a changed display name', async () => {
    const local = await seedLocal({ name: 'Old Name' });
    resolves(identityUser({ name: 'New Name' }));

    const user = await loginWithIdentity('credential');

    expect(user.name).toBe('New Name');
    expect((await readLocal(local.id)).name).toBe('New Name');
  });
});

describe('loginWithIdentity — refusals', () => {
  /**
   * This app has to be able to close its own door: deactivating someone here
   * locks them out immediately, without waiting on another service.
   */
  it('refuses a locally deactivated account even with a valid grant', async () => {
    await seedLocal({ isActive: false });
    resolves();

    await expect(loginWithIdentity('credential')).rejects.toThrow(IdentityAuthError);
    await expect(loginWithIdentity('credential')).rejects.toThrow(/deactivated/i);
  });

  // "No grant for this app" is a real colleague, not a stranger — the message
  // should send them to an admin, not make them doubt their account.
  it('reports no_app_access distinctly, and does not create an account', async () => {
    vi.mocked(googleLogin).mockResolvedValue({ reason: 'no_app_access', email: 'sam@x.com' });

    await expect(loginWithIdentity('credential')).rejects.toMatchObject({
      reason: 'no_app_access',
    });
    expect(await db.select().from(schema.staffUsers)).toHaveLength(0);
  });

  it('reports an invalid credential', async () => {
    vi.mocked(googleLogin).mockResolvedValue({ reason: 'invalid_credential' });

    await expect(loginWithIdentity('credential')).rejects.toMatchObject({
      reason: 'invalid_credential',
    });
  });

  it('reports the service being unavailable', async () => {
    vi.mocked(googleLogin).mockResolvedValue({ reason: 'unavailable' });

    await expect(loginWithIdentity('credential')).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('reports the seam being switched off', async () => {
    vi.mocked(googleLogin).mockResolvedValue({ reason: 'not_configured' });

    await expect(loginWithIdentity('credential')).rejects.toMatchObject({
      reason: 'not_configured',
    });
  });

  it('creates nothing when the credential is rejected', async () => {
    vi.mocked(googleLogin).mockResolvedValue({ reason: 'invalid_credential' });

    await expect(loginWithIdentity('credential')).rejects.toThrow();
    expect(await db.select().from(schema.staffUsers)).toHaveLength(0);
  });
});

describe('password login still works alongside it', () => {
  // Break-glass: SSO going down must not lock the team out of their own portal.
  it('leaves an existing password account able to sign in', async () => {
    const { hashPassword } = await import('@/lib/password');
    const { loginStaff } = await import('./service');
    await seedLocal({ passwordHash: await hashPassword('correct-horse') });

    const user = await loginStaff('sam@beastmode.co.nz', 'correct-horse');

    expect(user.email).toBe('sam@beastmode.co.nz');
  });

  it('does not let an identity-created account in through the password form', async () => {
    const { loginStaff } = await import('./service');
    resolves(identityUser({ email: 'new@beastmode.co.nz' }));
    await loginWithIdentity('credential');

    await expect(loginStaff('new@beastmode.co.nz', 'anything')).rejects.toThrow();
  });
});
