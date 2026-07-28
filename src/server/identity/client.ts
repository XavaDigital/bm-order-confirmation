/**
 * Outbound client for bm-identity — the fleet identity service (Google SSO
 * delegation and per-app access grants).
 *
 * Contract source of truth: bm-identity `src/routes/v1.ts` + its CLAUDE.md.
 * Four endpoints, and deliberately NO list-users: absorption is
 * just-in-time at login plus a per-request role re-check, never a roster sync.
 *
 * Discipline, matching `src/server/hub/client.ts` (fleet convention):
 *  - DORMANT unless IDENTITY_API_URL + IDENTITY_API_SECRET are set. Every call
 *    is a no-op, so the app runs fully standalone — which is how it runs today.
 *  - Best-effort and non-throwing for reads: an identity outage must never take
 *    the order portal down with it.
 *  - A FOURTH, separate credential. Per-app secrets are the fleet norm: the
 *    shared outbound hub secret, the per-app inbound capability secret, the
 *    legacy INTERNAL_API_KEY, and now this. Do not reuse one for another.
 */
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const TIMEOUT_MS = 5_000;

/** What bm-identity returns for a user (`toIdentityRecord`). */
export interface IdentityUser {
  id: string;
  email: string;
  name: string | null;
  disabled: boolean;
  avatarUrl: string | null;
  googleLinked: boolean;
  createdAt: string;
  /** Per-app grants, keyed by app id: `{ role, via: 'grant' | 'domain' }`. */
  grants: Record<string, { role: string; via?: 'grant' | 'domain' }>;
}

export interface GoogleLoginResult {
  user: IdentityUser;
  provisioned: boolean;
  access: { granted: true; role: string };
}

/**
 * Why a login was refused.
 *
 * `no_app_access` is emphatically NOT "unknown person" — bm-identity's own docs
 * call this out. It means a real, known colleague who has not been granted this
 * app, and the message shown to them should say so rather than implying their
 * account is wrong.
 */
export type IdentityLoginFailure =
  | { reason: 'not_configured' }
  | { reason: 'invalid_credential' }
  | { reason: 'no_app_access'; email?: string }
  | { reason: 'unavailable' };

export function isIdentityConfigured(): boolean {
  return Boolean(env.IDENTITY_API_URL && env.IDENTITY_API_SECRET);
}

async function call(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response | null> {
  if (!isIdentityConfigured()) return null;
  const base = env.IDENTITY_API_URL!.replace(/\/+$/, '');
  try {
    return await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${env.IDENTITY_API_SECRET}`,
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.error('[identity] call failed:', path, err);
    return null;
  }
}

/**
 * Exchange a Google credential for an identity record and this app's role.
 *
 * Returns a discriminated failure rather than throwing, because the caller has
 * to render four visibly different outcomes and a thrown error flattens them
 * into one unhelpful message.
 */
export async function googleLogin(
  credential: string,
): Promise<GoogleLoginResult | IdentityLoginFailure> {
  if (!isIdentityConfigured()) return { reason: 'not_configured' };

  const res = await call('/v1/google-login', { method: 'POST', body: { credential } });
  if (!res) return { reason: 'unavailable' };

  if (res.status === 401) return { reason: 'invalid_credential' };
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    // The message carries the email; the code is what identifies the case.
    return { reason: 'no_app_access', email: body.message?.split(' ')[0] };
  }
  if (!res.ok) {
    logger.error('[identity] google-login failed', { status: res.status });
    return { reason: 'unavailable' };
  }

  return (await res.json()) as GoogleLoginResult;
}

/**
 * Re-read a user, for the per-request role re-check.
 *
 * The failure modes are deliberately ASYMMETRIC:
 *  - transport error / 5xx → `null`, and the caller must serve the cached role.
 *    An identity outage logging everyone out of the order portal would be a far
 *    worse incident than a stale role for a minute.
 *  - definitive 404 → `'gone'`, and the caller fails closed. The account really
 *    is not there any more.
 */
export async function getIdentityUser(
  identityUserId: string,
): Promise<IdentityUser | 'gone' | null> {
  const res = await call(`/v1/users/${encodeURIComponent(identityUserId)}`);
  if (!res) return null;
  if (res.status === 404) return 'gone';
  if (!res.ok) return null;
  return (await res.json()) as IdentityUser;
}

export async function getIdentityUserByEmail(
  email: string,
): Promise<IdentityUser | 'gone' | null> {
  const res = await call(`/v1/users/by-email/${encodeURIComponent(email)}`);
  if (!res) return null;
  if (res.status === 404) return 'gone';
  if (!res.ok) return null;
  return (await res.json()) as IdentityUser;
}

/**
 * Pre-provision a colleague so they can sign in before they ever have.
 *
 * A duplicate email is a 409 that still returns the existing record, and merges
 * only MISSING grants — it never downgrades an existing one. Treated as success
 * here, because "they already exist" is the outcome the caller wanted.
 */
export async function preProvisionUser(input: {
  email: string;
  name?: string;
  grants?: Record<string, { role: string }>;
}): Promise<IdentityUser | null> {
  const res = await call('/v1/users', { method: 'POST', body: input });
  if (!res) return null;
  if (!res.ok && res.status !== 409) {
    logger.error('[identity] pre-provision failed', { status: res.status });
    return null;
  }
  return (await res.json().catch(() => null)) as IdentityUser | null;
}

/**
 * This app's role for a user, from a grants map.
 *
 * Unknown roles map to null rather than to 'sales', so a role this app has not
 * been taught cannot silently become the default. The caller keeps the current
 * role in that case — never demote on a value we do not understand.
 */
export function roleFromGrants(
  grants: IdentityUser['grants'],
  appId: string,
): 'sales' | 'admin' | null {
  const role = grants?.[appId]?.role;
  if (role === 'admin' || role === 'sales') return role;
  return null;
}
