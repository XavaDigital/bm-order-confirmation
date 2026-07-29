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
  return {
    ...actual,
    isIdentityConfigured: vi.fn(() => true),
    getIdentityUser: vi.fn(),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { getIdentityUser, isIdentityConfigured } from '@/server/identity/client';
import { ACCESS_CACHE_TTL_MS, __clearAccessCache, checkAccess } from './access';

const IDENTITY_ID = '22222222-2222-4222-8222-222222222222';

afterEach(async () => {
  await resetTestDb(db);
  __clearAccessCache();
  vi.useRealTimers();
});

beforeEach(() => {
  __clearAccessCache();
  vi.mocked(isIdentityConfigured).mockReturnValue(true);
  vi.mocked(getIdentityUser).mockReset();
});

async function seedUser(overrides: Partial<typeof schema.staffUsers.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.staffUsers)
    .values({
      email: 'sam@beastmode.co.nz',
      name: 'Sam',
      passwordHash: 'x',
      role: 'sales',
      identityUserId: IDENTITY_ID,
      ...overrides,
    })
    .returning();
  return row;
}

function identityRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: IDENTITY_ID,
    email: 'sam@beastmode.co.nz',
    name: 'Sam',
    disabled: false,
    avatarUrl: null,
    googleLinked: true,
    createdAt: '2026-01-01T00:00:00Z',
    grants: { 'bm-orders': { role: 'sales' } },
    ...overrides,
  } as never;
}

describe('checkAccess — the live re-check', () => {
  it('returns the role identity currently reports', async () => {
    const user = await seedUser({ role: 'sales' });
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord());

    const result = await checkAccess({ staffUserId: user.id, sessionRole: 'sales' });

    expect(result).toEqual({ ok: true, role: 'sales' });
  });

  /**
   * The contract requires a downgrade to bite on a LIVE session, not at next
   * sign-in — so the freshly-read role wins over whatever the cookie says.
   */
  it('applies a downgrade over the session role', async () => {
    const user = await seedUser({ role: 'admin' });
    vi.mocked(getIdentityUser).mockResolvedValue(
      identityRecord({ grants: { 'bm-orders': { role: 'viewer' } } }),
    );

    const result = await checkAccess({ staffUserId: user.id, sessionRole: 'admin' });

    expect(result).toEqual({ ok: true, role: 'viewer' });
    // and the local row is brought into line
    const [row] = await db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, user.id));
    expect(row.role).toBe('viewer');
  });

  it('ends the session when the grant is revoked', async () => {
    const user = await seedUser({ role: 'admin' });
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord({ grants: {} }));

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'admin' })).toEqual({
      ok: false,
      reason: 'no_access',
    });
  });

  /**
   * REGRESSION (live, 2026-07-29): the exact grants map identity returned for a
   * revoked user — a grant for a DIFFERENT app and no key for this one. The
   * revocation did not land, so this shape is pinned.
   */
  it('ends the session when only another app’s grant remains', async () => {
    const user = await seedUser({ role: 'admin' });
    vi.mocked(getIdentityUser).mockResolvedValue(
      identityRecord({ grants: { identity: { role: 'admin', via: 'grant' } } }),
    );

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'admin' })).toEqual({
      ok: false,
      reason: 'no_access',
    });
  });

  it('ends the session for a role this app cannot speak', async () => {
    const user = await seedUser();
    vi.mocked(getIdentityUser).mockResolvedValue(
      identityRecord({ grants: { 'bm-orders': { role: 'designer' } } }),
    );

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'sales' })).toEqual({
      ok: false,
      reason: 'no_access',
    });
  });

  it('ends the session when identity says the user is disabled', async () => {
    const user = await seedUser();
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord({ disabled: true }));

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'sales' })).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });

  it('ends the session when the identity record is gone', async () => {
    const user = await seedUser();
    vi.mocked(getIdentityUser).mockResolvedValue('gone');

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'sales' })).toEqual({
      ok: false,
      reason: 'gone',
    });
  });

  it('ends the session when the local row has been deleted', async () => {
    expect(
      await checkAccess({
        staffUserId: '33333333-3333-4333-8333-333333333333',
        sessionRole: 'admin',
      }),
    ).toEqual({ ok: false, reason: 'gone' });
  });
});

/**
 * This app has to be able to close its own door without waiting on another
 * service, so the local row is read on every request rather than being skipped
 * whenever the session already knows the identity id.
 */
describe('checkAccess — the local door', () => {
  it('ends the session for a locally deactivated account', async () => {
    const user = await seedUser({ isActive: false });

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'sales' })).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });

  // REGRESSION: local deactivation used to be skipped entirely for a live SSO
  // session, because a session-supplied identity id bypassed the local read.
  it('ends the session for a deactivated account even with a good grant cached', async () => {
    const user = await seedUser({ isActive: true });
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord());
    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'sales' })).toEqual({
      ok: true,
      role: 'sales',
    });

    await db
      .update(schema.staffUsers)
      .set({ isActive: false })
      .where(eq(schema.staffUsers.id, user.id));

    // Immediately — not after the 60s grant cache expires.
    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'sales' })).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });
});

/**
 * The bug that made the live revocation test fail: every account predating SSO
 * has a null `identityUserId`, and exempting unlinked accounts from the
 * re-check exempted everybody — the identity call was never even made.
 */
describe('checkAccess — an account identity cannot vouch for', () => {
  it('refuses an unlinked account while identity is configured', async () => {
    const user = await seedUser({ identityUserId: null, role: 'admin' });

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'admin' })).toEqual({
      ok: false,
      reason: 'no_access',
    });
  });

  it('does not fall back to the session role for an unlinked account', async () => {
    const user = await seedUser({ identityUserId: null, role: 'admin' });

    const result = await checkAccess({ staffUserId: user.id, sessionRole: 'admin' });

    expect(result.ok).toBe(false);
    expect(getIdentityUser).not.toHaveBeenCalled();
  });
});

describe('checkAccess — caching', () => {
  it('does not re-read identity within the TTL', async () => {
    const user = await seedUser();
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord());

    await checkAccess({ staffUserId: user.id, sessionRole: 'sales' });
    await checkAccess({ staffUserId: user.id, sessionRole: 'sales' });
    await checkAccess({ staffUserId: user.id, sessionRole: 'sales' });

    expect(getIdentityUser).toHaveBeenCalledTimes(1);
  });

  // The TTL is the guarantee that a revocation lands; it must actually expire.
  it('re-reads once the TTL has passed, and picks up a revocation', async () => {
    vi.useFakeTimers();
    const user = await seedUser();
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord());

    await checkAccess({ staffUserId: user.id, sessionRole: 'sales' });
    expect(getIdentityUser).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ACCESS_CACHE_TTL_MS + 1);
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord({ grants: {} }));

    const after = await checkAccess({ staffUserId: user.id, sessionRole: 'sales' });

    expect(getIdentityUser).toHaveBeenCalledTimes(2);
    expect(after).toEqual({ ok: false, reason: 'no_access' });
  });

  it('caps the cache at 60 seconds, as the contract requires', () => {
    expect(ACCESS_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('checkAccess — identity unreachable', () => {
  /**
   * Stale-while-error. An identity outage logging out the whole company would be
   * a far worse incident than a revocation taking an extra minute.
   */
  it('serves the last known good role when identity cannot be reached', async () => {
    vi.useFakeTimers();
    const user = await seedUser({ role: 'admin' });
    vi.mocked(getIdentityUser).mockResolvedValue(
      identityRecord({ grants: { 'bm-orders': { role: 'admin' } } }),
    );
    await checkAccess({ staffUserId: user.id, sessionRole: 'admin' });

    vi.advanceTimersByTime(ACCESS_CACHE_TTL_MS + 1);
    vi.mocked(getIdentityUser).mockResolvedValue(null); // unreachable

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'admin' })).toEqual({
      ok: true,
      role: 'admin',
    });
  });

  it('falls back to the session role when unreachable with nothing cached', async () => {
    const user = await seedUser();
    vi.mocked(getIdentityUser).mockResolvedValue(null);

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'sales' })).toEqual({
      ok: true,
      role: 'sales',
    });
  });

  // A definitive "no" is obeyed even though an outage would have been tolerated.
  it('obeys a definitive no-access even after a period of being unreachable', async () => {
    vi.useFakeTimers();
    const user = await seedUser();
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord());
    await checkAccess({ staffUserId: user.id, sessionRole: 'sales' });

    vi.advanceTimersByTime(ACCESS_CACHE_TTL_MS + 1);
    vi.mocked(getIdentityUser).mockResolvedValue(null);
    await checkAccess({ staffUserId: user.id, sessionRole: 'sales' });

    vi.advanceTimersByTime(ACCESS_CACHE_TTL_MS + 1);
    vi.mocked(getIdentityUser).mockResolvedValue(identityRecord({ grants: {} }));

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'sales' })).toEqual({
      ok: false,
      reason: 'no_access',
    });
  });
});

describe('checkAccess — identity switched off', () => {
  // Standalone deployment: identity was never the source of truth for this
  // account, so the local role stands. The ONLY case an unlinked account passes.
  it('uses the local role when the seam is unconfigured', async () => {
    vi.mocked(isIdentityConfigured).mockReturnValue(false);
    const user = await seedUser({ role: 'admin', identityUserId: null });

    expect(await checkAccess({ staffUserId: user.id, sessionRole: 'admin' })).toEqual({
      ok: true,
      role: 'admin',
    });
    expect(getIdentityUser).not.toHaveBeenCalled();
  });
});
