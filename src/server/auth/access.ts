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
  sessionRole: StaffRole;
}): Promise<AccessDecision> {
  // The seam is switched off (local dev, or a standalone deployment): identity
  // was never the source of truth for this account, so the local role stands.
  // This is the ONLY case in which an unlinked account is allowed through.
  if (!isIdentityConfigured()) return { ok: true, role: params.sessionRole };

  /**
   * The local row is read on EVERY request and is never skipped via a hint from
   * the session. Two things hang off it and both have to be immediate:
   *
   *  - `isActive` — this app must be able to close its own door without waiting
   *    on another service, so a local deactivation cannot sit behind the cache.
   *  - `identityUserId` — whether this account is subject to identity at all. A
   *    session cookie must not be able to assert a link the database lacks.
   */
  const [row] = await db
    .select({ identityUserId: staffUsers.identityUserId, isActive: staffUsers.isActive })
    .from(staffUsers)
    .where(eq(staffUsers.id, params.staffUserId));
  if (!row) return { ok: false, reason: 'gone' };
  if (!row.isActive) return { ok: false, reason: 'disabled' };

  const identityUserId = row.identityUserId;
  if (!identityUserId) {
    /**
     * Identity is configured, so it is the ONLY source of truth for access — and
     * this account has never been linked to it, so there is nothing to re-check
     * it against. The contract has no "cannot verify, therefore allow" outcome.
     *
     * This is exactly what let a revoked grant keep working: every account
     * predating SSO is unlinked, so exempting unlinked accounts exempted
     * everyone, and the identity call was never even made. Password login is
     * already refused while identity is on, so the way back in is Google
     * sign-in, which stamps the link.
     */
    return { ok: false, reason: 'no_access' };
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
