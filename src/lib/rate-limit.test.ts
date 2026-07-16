import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit, checkRateLimitAsync, rateLimitedResponse, getClientIp } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the first request for a fresh key', () => {
    const result = checkRateLimit('key-fresh-1', 3, 1000);
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it('allows up to maxRequests then rejects the next one', () => {
    const key = 'key-boundary-1';
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true); // 1
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true); // 2
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true); // 3
    const fourth = checkRateLimit(key, 3, 60_000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets the window after windowMs elapses', () => {
    const key = 'key-reset-1';
    checkRateLimit(key, 1, 1000); // consumes the only slot
    expect(checkRateLimit(key, 1, 1000).allowed).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(checkRateLimit(key, 1, 1000).allowed).toBe(true);
  });

  it('tracks independent counters per key', () => {
    const a = 'key-independent-a';
    const b = 'key-independent-b';
    checkRateLimit(a, 1, 60_000);
    expect(checkRateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(checkRateLimit(b, 1, 60_000).allowed).toBe(true);
  });
});

describe('getClientIp', () => {
  function headersFrom(map: Record<string, string>) {
    return { get: (key: string) => map[key] ?? null };
  }

  it('reads the last (proxy-appended) entry of x-forwarded-for, not the client-suppliable leftmost one', () => {
    const headers = headersFrom({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(headers)).toBe('5.6.7.8');
  });

  it('ignores a spoofed leftmost entry designed to defeat rate limiting', () => {
    const headers = headersFrom({ 'x-forwarded-for': 'attacker-spoofed-ip, 9.9.9.9' });
    expect(getClientIp(headers)).toBe('9.9.9.9');
  });

  it('prefers x-vercel-forwarded-for (edge-set, never client-suppliable) over x-forwarded-for', () => {
    const headers = headersFrom({
      'x-vercel-forwarded-for': '9.8.7.6',
      'x-forwarded-for': 'attacker-spoofed-ip',
    });
    expect(getClientIp(headers)).toBe('9.8.7.6');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const headers = headersFrom({ 'x-real-ip': '9.8.7.6' });
    expect(getClientIp(headers)).toBe('9.8.7.6');
  });

  it('falls back to "unknown" when no headers are present', () => {
    const headers = headersFrom({});
    expect(getClientIp(headers)).toBe('unknown');
  });
});

// checkRateLimitAsync() tries the Postgres-backed rate_limits table first. In this
// plain unit-test run '@/db' is NOT mocked to PGlite (that's only done in
// *.integration.test.ts files), and .env.test's DATABASE_URL points at a port
// nothing is listening on, so the query fails fast and these exercise the
// in-memory fallback documented at the top of rate-limit.ts. The Postgres-backed
// path itself is covered by rate-limit.integration.test.ts.
describe('checkRateLimitAsync (DB unreachable → in-memory fallback)', () => {
  it('falls back to the in-memory limiter and rate-limits after maxRequests', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const key = 'db-fallback-boundary-1';

    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimitAsync(key, 3, 60_000)).allowed).toBe(true);
    }
    const fourth = await checkRateLimitAsync(key, 3, 60_000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[rate-limit] Postgres check failed'),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it('rateLimitedResponse returns a 429 with Retry-After once the fallback limit is exceeded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const key = 'db-fallback-route-1';

    for (let i = 0; i < 5; i++) {
      expect(await rateLimitedResponse(key, 5, 60_000, 'Too many requests.')).toBeNull();
    }
    const res = await rateLimitedResponse(key, 5, 60_000, 'Too many requests.');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get('Retry-After')).not.toBeNull();

    vi.restoreAllMocks();
  });
});
