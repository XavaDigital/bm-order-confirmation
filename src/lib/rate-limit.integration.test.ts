import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { checkRateLimitAsync, rateLimitedResponse } from './rate-limit';

afterEach(async () => {
  await resetTestDb(db);
});

describe('checkRateLimitAsync (Postgres-backed)', () => {
  it('allows up to maxRequests then rejects the next one, persisting the counter', async () => {
    const key = 'pg-boundary-1';
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimitAsync(key, 3, 60_000)).allowed).toBe(true);
    }
    const fourth = await checkRateLimitAsync(key, 3, 60_000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);

    const row = await db.query.rateLimits.findFirst({ where: eq(schema.rateLimits.key, key) });
    expect(row!.count).toBe(4);
  });

  it('tracks independent counters per key', async () => {
    const a = 'pg-independent-a';
    const b = 'pg-independent-b';
    await checkRateLimitAsync(a, 1, 60_000);
    expect((await checkRateLimitAsync(a, 1, 60_000)).allowed).toBe(false);
    expect((await checkRateLimitAsync(b, 1, 60_000)).allowed).toBe(true);
  });

  it('resets the window once the stored window_start is older than windowMs', async () => {
    const key = 'pg-reset-1';
    await db.insert(schema.rateLimits).values({
      key,
      windowStart: new Date(Date.now() - 120_000),
      count: 99,
    });

    const result = await checkRateLimitAsync(key, 5, 60_000);
    expect(result.allowed).toBe(true);

    const row = await db.query.rateLimits.findFirst({ where: eq(schema.rateLimits.key, key) });
    expect(row!.count).toBe(1);
  });

  it('keeps the window (does not reset) while still within windowMs', async () => {
    const key = 'pg-no-reset-1';
    await db.insert(schema.rateLimits).values({
      key,
      windowStart: new Date(Date.now() - 5_000),
      count: 2,
    });

    const result = await checkRateLimitAsync(key, 5, 60_000);
    expect(result.allowed).toBe(true);

    const row = await db.query.rateLimits.findFirst({ where: eq(schema.rateLimits.key, key) });
    expect(row!.count).toBe(3);
  });

  it('rateLimitedResponse returns null while allowed and a 429 with Retry-After once exceeded', async () => {
    const key = 'pg-route-1';
    for (let i = 0; i < 2; i++) {
      expect(await rateLimitedResponse(key, 2, 60_000, 'Too many requests.')).toBeNull();
    }
    const res = await rateLimitedResponse(key, 2, 60_000, 'Too many requests.');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get('Retry-After')).not.toBeNull();
  });
});
