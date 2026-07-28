/**
 * Live-session access re-check against bm-identity.
 *
 * Fleet access contract: identity is the ONLY source of truth for whether a
 * person may use this app and in what role. A grant may be lowered or revoked
 * at any moment, so a role read once at sign-in is not good enough — it is
 * re-read at most every 60 seconds and the answer is obeyed, including when the
 * answer is "no access".
 *
 * Failure handling is asymmetric on purpose:
 *  - identity ANSWERS "no access" / "disabled" → end the session now.
 *  - identity is UNREACHABLE → keep serving the last known good value
 *    (stale-while-error). An identity outage must not log out the whole company;
 *    a revocation that takes an extra minute during an outage is the lesser harm.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { staffUsers } from '@/db/schema';
import { env } from '@/lib/env';
import { getIdentityUser, isIdentityConfigured, roleFromGrants } from '@/server/identity/client';
import { type StaffRole } from '@/lib/roles';
import { logger } from '@/lib/logger';

/** Contract: cache the grant for at most 60 seconds, then re-read. */
export const ACCESS_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  role: StaffRole;
  checkedAt: number;
}

/**
 * Per-process cache. Deliberately not shared across containers: the TTL is the
 * guarantee, and a shared cache would add a failure mode for no extra safety.
 */
const cache = new Map<string, CacheEntry>();

/** Testing seam — the cache is process-global, so tests must be able to clear it. */
export function __clearAccessCache(): void {
  cache.clear();
}

export type AccessDecision =
  | { ok: true; role: StaffRole }
  /** Session must end. `reason` is for the message, not for a fallback. */
  | { ok: false; reason: 'no_access' | 'disabled' | 'gone' };

/**
 * The current role for a signed-in user, re-checked against identity.
 *
 * Returns `{ ok: true }` with the role to use. A `false` result means the
 * session must be ended — there is deliberately no "reduced access" outcome,
 * because the contract has no such thing.
 */
export async function checkAccess(params: {
  staffUserId: string;
  /** Cached in the session; used to avoid a DB read on the hot path. */
  identityUserId?: string | null;
  sessionRole: StaffRole;
}): Promise<AccessDecision> {
  // Password-only account, or the seam switched off: identity has no opinion, so
  // the local role stands. This is NOT a fallback for an identity answer — it is
  // the case where identity was never the source of truth for this account.
  if (!isIdentityConfigured()) return { ok: true, role: params.sessionRole };

  let identityUserId = params.identityUserId ?? null;
  if (identityUserId === null) {
    const [row] = await db
      .select({ identityUserId: staffUsers.identityUserId, isActive: staffUsers.isActive })
      .from(staffUsers)
      .where(eq(staffUsers.id, params.staffUserId));
    if (!row) return { ok: false, reason: 'gone' };
    if (!row.isActive) return { ok: false, reason: 'disabled' };
    identityUserId = row.identityUserId;
    // Not an identity-linked account (password break-glass): nothing to re-check.
    if (!identityUserId) return { ok: true, role: params.sessionRole };
  }

  const cached = cache.get(identityUserId);
  if (cached && Date.now() - cached.checkedAt < ACCESS_CACHE_TTL_MS) {
    return { ok: true, role: cached.role };
  }

  const identity = await getIdentityUser(identityUserId);

  // Unreachable. Serve the last known good value rather than logging everyone
  // out during an identity outage.
  if (identity === null) {
    if (cached) return { ok: true, role: cached.role };
    logger.warn('[access] identity unreachable and nothing cached; serving session role');
    return { ok: true, role: params.sessionRole };
  }

  // Definitive answers below — identity spoke, so obey it.
  if (identity === 'gone') {
    cache.delete(identityUserId);
    return { ok: false, reason: 'gone' };
  }
  if (identity.disabled) {
    cache.delete(identityUserId);
    return { ok: false, reason: 'disabled' };
  }

  const role = roleFromGrants(identity.grants, env.IDENTITY_APP_ID);
  if (role === 'none') {
    // Grant revoked, or a role string this app cannot speak. Either way: out.
    cache.delete(identityUserId);
    return { ok: false, reason: 'no_access' };
  }

  cache.set(identityUserId, { role, checkedAt: Date.now() });

  // Keep the local row honest, so anything reading it directly agrees. Failure
  // here must not fail the request.
  try {
    await db
      .update(staffUsers)
      .set({ role })
      .where(eq(staffUsers.id, params.staffUserId));
  } catch (err) {
    logger.error('[access] failed to sync local role', err);
  }

  return { ok: true, role };
}
