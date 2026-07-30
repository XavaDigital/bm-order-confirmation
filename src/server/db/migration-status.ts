/**
 * Are the migrations on disk applied to the database this build is pointed at?
 *
 * Why this exists: drizzle builds an explicit column list from `schema.ts`, so a
 * build deployed ahead of its migration throws `column does not exist` on every
 * query touching that table — while `/login` and `/api/health` keep answering
 * 200, because they touch neither. The smoke test passes and the app is down.
 * That happened on 2026-07-30 with 0027.
 *
 * The FAILURE ASYMMETRY is the point, and mirrors the identity client:
 *
 *   - a definitive answer ("3 migrations are not applied")  → refuse to start
 *   - the check itself failing (cannot connect, table absent, timeout) → start
 *     anyway and say so loudly
 *
 * Getting that backwards would mean a transient database blip during a deploy
 * takes the app down, which is a worse outage than the one being prevented.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export interface MigrationStatus {
  /** Migration tags present on disk, in journal order. */
  expected: string[];
  /** How many the database says it has applied. */
  appliedCount: number;
  /** Tags on disk with no corresponding applied row — in the order they must run. */
  pending: string[];
}

/**
 * `null` means the check could not be performed — NOT that everything is fine.
 * Callers must treat it as "unknown" and let the app start.
 */
export async function getMigrationStatus(): Promise<MigrationStatus | null> {
  let expected: string[];
  try {
    const journalPath = join(process.cwd(), 'drizzle', 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries?: { idx: number; tag: string }[];
    };
    expected = [...(journal.entries ?? [])]
      .sort((a, b) => a.idx - b.idx)
      .map((entry) => entry.tag);
  } catch {
    // The standalone build may not ship the drizzle folder. Nothing to compare
    // against, so this is "unknown", not "up to date".
    return null;
  }

  try {
    /**
     * Counted, not matched by name: drizzle records a HASH of each migration's
     * SQL, not its tag, so there is no way to say WHICH are missing — only how
     * many. Drizzle applies them in journal order and never skips, so the
     * pending set is the tail of the journal beyond the applied count.
     */
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    const appliedCount = Number((rows as unknown as { n: number }[])[0]?.n ?? 0);

    return {
      expected,
      appliedCount,
      pending: appliedCount >= expected.length ? [] : expected.slice(appliedCount),
    };
  } catch {
    // No drizzle schema yet (a fresh database), no permission, or the database
    // is briefly unreachable. All "unknown".
    return null;
  }
}
