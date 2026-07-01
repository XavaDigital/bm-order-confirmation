import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit, getClientIp } from './rate-limit';

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

  it('reads the first entry of x-forwarded-for', () => {
    const headers = headersFrom({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(headers)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const headers = headersFrom({ 'x-real-ip': '9.8.7.6' });
    expect(getClientIp(headers)).toBe('9.8.7.6');
  });

  it('falls back to "unknown" when neither header is present', () => {
    const headers = headersFrom({});
    expect(getClientIp(headers)).toBe('unknown');
  });
});
