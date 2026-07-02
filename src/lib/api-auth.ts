import { timingSafeEqual } from 'node:crypto';
import { env } from './env';

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
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Auth for Vercel Cron invocations of /api/internal/process-outbox. Vercel
 * sends `Authorization: Bearer $CRON_SECRET`, not `x-api-key` — so this is
 * checked separately from (and in addition to) `isInternalAuthorized`.
 * No-op (always false) unless CRON_SECRET is configured.
 */
export function isCronAuthorized(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const expected = env.CRON_SECRET ?? '';
  if (!expected || !auth.startsWith('Bearer ')) return false;
  const provided = auth.slice('Bearer '.length);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
