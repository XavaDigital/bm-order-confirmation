/**
 * Rate limiting, two-tier (roadmap 3.3):
 *
 *  1. checkRateLimitAsync() / rateLimitedResponse() — the path every route
 *     should use. Backed by the `rate_limits` Postgres table via a single
 *     atomic upsert, so the counter is correct across horizontally-scaled
 *     instances and survives deploys (unlike the in-memory Map below).
 *  2. checkRateLimit() — in-memory fallback, used automatically when the DB
 *     call throws (and exercised directly by plain unit tests, since
 *     .env.test's DATABASE_URL points nowhere and fails fast). Also correct
 *     for genuinely single-instance/dev setups on its own.
 *
 * Each key has a fixed window: the first request in a new window sets a
 * counter that resets at windowMs. Subsequent requests in that same window
 * increment the counter and are rejected once it hits maxRequests.
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimits } from '@/db/schema';
import { logger } from '@/lib/logger';

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

// Periodic cleanup so the Map doesn't grow forever in long-lived processes.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 5 * 60 * 1_000).unref?.();
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the window resets (only meaningful when allowed=false). */
  retryAfterMs: number;
}

/**
 * Named rate-limit presets — every limited route picks one of these instead
 * of restating magic numbers. Add a preset rather than a one-off tuple.
 */
export const RATE_LIMITS = {
  /** Unauthenticated customer-surface writes (and login per-IP): 10 / 15 min. */
  customerWrite: { maxRequests: 10, windowMs: 15 * 60 * 1_000 },
  /** Credential endpoints keyed per account/email: 5 / 15 min. */
  credential: { maxRequests: 5, windowMs: 15 * 60 * 1_000 },
  /** 2FA code verification: 5 / 5 min. */
  twoFactor: { maxRequests: 5, windowMs: 5 * 60 * 1_000 },
  /** Customer-facing PDF render (read, but expensive): 20 / 15 min. */
  customerPdf: { maxRequests: 20, windowMs: 15 * 60 * 1_000 },
} as const;

export type RateLimitPreset = { maxRequests: number; windowMs: number };

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Postgres-backed equivalent of checkRateLimit(), atomic under concurrent
 * callers (single INSERT ... ON CONFLICT DO UPDATE): the CASE resets the
 * window when it has expired, otherwise increments the existing count. Falls
 * back to the in-memory checkRateLimit() if the DB is unreachable.
 */
export async function checkRateLimitAsync(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart: new Date(), count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          windowStart: sql`CASE WHEN ${rateLimits.windowStart} <= now() - (${windowMs} * interval '1 millisecond') THEN now() ELSE ${rateLimits.windowStart} END`,
          count: sql`CASE WHEN ${rateLimits.windowStart} <= now() - (${windowMs} * interval '1 millisecond') THEN 1 ELSE ${rateLimits.count} + 1 END`,
        },
      })
      .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });

    if (!row) throw new Error('rate_limits upsert returned no row');

    const resetAt = row.windowStart.getTime() + windowMs;
    const allowed = row.count <= maxRequests;
    return { allowed, retryAfterMs: allowed ? 0 : Math.max(0, resetAt - Date.now()) };
  } catch (err) {
    logger.error('[rate-limit] Postgres check failed, falling back to in-memory limiter:', err);
    return checkRateLimit(key, maxRequests, windowMs);
  }
}

/**
 * Purge rate-limit rows whose window ended more than a day ago. Without this
 * the table grows one permanent row per client IP per limited route, forever.
 * Called from the process-outbox cron; best-effort (a failed purge never
 * breaks event processing).
 */
export async function purgeExpiredRateLimits(): Promise<number> {
  try {
    const result = await db
      .delete(rateLimits)
      .where(sql`${rateLimits.windowStart} < now() - interval '1 day'`)
      .returning({ key: rateLimits.key });
    return result.length;
  } catch (err) {
    logger.error('[rate-limit] purge failed:', err);
    return 0;
  }
}

/**
 * Checks the rate limit and returns a ready-to-return 429 `NextResponse`
 * (with `Retry-After` set) when exceeded, or `null` when the request is
 * allowed through.
 */
export async function rateLimitedResponse(
  key: string,
  preset: RateLimitPreset,
  message: string,
): Promise<NextResponse | null> {
  const rl = await checkRateLimitAsync(key, preset.maxRequests, preset.windowMs);
  if (rl.allowed) return null;
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1_000)) } },
  );
}

/**
 * Extract the best available client IP from a Next.js request.
 *
 * `x-forwarded-for` is a client-suppliable header: a request can arrive with
 * an attacker-chosen value already in it. A trusted reverse proxy (Vercel's
 * edge, nginx, etc.) appends the real connecting IP as the *last* entry
 * rather than replacing the header, so the leftmost entry can never be
 * trusted for rate limiting or abuse detection — only the rightmost one
 * (or a platform-specific header set exclusively by the edge, never by the
 * client) can be.
 */
export function getClientIp(headers: { get(key: string): string | null }): string {
  // Vercel's edge sets this header exclusively — but ONLY on Vercel. On any
  // other host (Cloud Run today) nothing strips a client-supplied copy, so
  // trusting it unconditionally let an attacker choose their own rate-limit
  // bucket (July assessment §6.2 — same class as the x-forwarded-for fix).
  if (process.env.VERCEL) {
    const vercelForwardedFor = headers.get('x-vercel-forwarded-for');
    if (vercelForwardedFor) return vercelForwardedFor.split(',')[0]?.trim() ?? 'unknown';
  }

  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const entries = forwardedFor.split(',').map((entry) => entry.trim());
    const last = entries[entries.length - 1];
    if (last) return last;
  }

  return headers.get('x-real-ip') ?? 'unknown';
}
