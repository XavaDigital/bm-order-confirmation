/**
 * In-memory sliding-window rate limiter.
 *
 * Works correctly for single-instance deployments. For multi-instance setups
 * (horizontal scaling), replace the Map with a shared Redis store such as
 * @upstash/ratelimit + Upstash Redis.
 *
 * Each key has a fixed window: the first request in a new window sets a
 * counter that resets at windowMs. Subsequent requests in that same window
 * increment the counter and are rejected once it hits maxRequests.
 */
import { NextResponse } from 'next/server';

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
 * Checks the rate limit and returns a ready-to-return 429 `NextResponse`
 * (with `Retry-After` set) when exceeded, or `null` when the request is
 * allowed through.
 */
export function rateLimitedResponse(
  key: string,
  maxRequests: number,
  windowMs: number,
  message: string,
): NextResponse | null {
  const rl = checkRateLimit(key, maxRequests, windowMs);
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
  const vercelForwardedFor = headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) return vercelForwardedFor.split(',')[0]?.trim() ?? 'unknown';

  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const entries = forwardedFor.split(',').map((entry) => entry.trim());
    const last = entries[entries.length - 1];
    if (last) return last;
  }

  return headers.get('x-real-ip') ?? 'unknown';
}
