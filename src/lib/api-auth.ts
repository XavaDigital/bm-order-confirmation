import { timingSafeEqual } from 'node:crypto';
import { env } from './env';

/** Length-safe constant-time string comparison for shared secrets. */
function constantTimeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bearer-token extraction; null when the header is missing or not Bearer. */
function bearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
}

/**
 * Service-to-service auth for the order ingestion API (PROJECT_BRIEF.md §15).
 *
 * STUB: a shared `x-api-key` header for now. When the sales platform integrates,
 * swap this for OAuth client-credentials / signed requests without touching the
 * route handlers — they only call `assertInternalAuth`.
 */
export function isInternalAuthorized(req: Request): boolean {
  const provided = req.headers.get('x-api-key') ?? '';
  const expected = env.INTERNAL_API_KEY ?? '';
  if (!provided || !expected) return false;
  return constantTimeEquals(provided, expected);
}

/**
 * Auth for the fleet inbound capability surface (/api/capability/v1/*) — the
 * per-app bearer secret the Sales Hub / Email Flow presents when calling THIS
 * app (fleet convention: distinct from the shared outbound CAPABILITY_API_SECRET
 * and from INTERNAL_API_KEY). Returns:
 *   'ok'            — valid bearer
 *   'unauthorized'  — wrong/missing bearer (route responds 401)
 *   'unconfigured'  — secret not set on this server (route responds 503, matching
 *                     the fleet's "not configured ≠ forbidden" convention)
 */
export function checkCapabilityAuth(req: Request): 'ok' | 'unauthorized' | 'unconfigured' {
  const expected = env.INBOUND_CAPABILITY_SECRET ?? '';
  if (!expected) return 'unconfigured';
  const provided = bearerToken(req);
  if (provided === null) return 'unauthorized';
  return constantTimeEquals(provided, expected) ? 'ok' : 'unauthorized';
}

/**
 * Auth for Vercel Cron invocations of /api/internal/process-outbox. Vercel
 * sends `Authorization: Bearer $CRON_SECRET`, not `x-api-key` — so this is
 * checked separately from (and in addition to) `isInternalAuthorized`.
 * No-op (always false) unless CRON_SECRET is configured.
 */
export function isCronAuthorized(req: Request): boolean {
  const expected = env.CRON_SECRET ?? '';
  if (!expected) return false;
  const provided = bearerToken(req);
  return provided !== null && constantTimeEquals(provided, expected);
}
