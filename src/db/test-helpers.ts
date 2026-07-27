/**
 * Test-only PGlite-backed database. Never imported by production code — used
 * exclusively via vi.mock('@/db', ...) in *.integration.test.ts files so that
 * service modules (which import { db } from '@/db') transparently run against
 * an in-process Postgres instead of a real one.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql, getTableName } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import path from 'node:path';
import * as schema from './schema';

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Minimal structural type both PgliteDatabase and PostgresJsDatabase satisfy.
 * resetTestDb() is called with two different static types depending on the
 * caller: the real (postgres-js-typed) `db` imported from '@/db' in every
 * *.integration.test.ts file (vi.mock swaps the RUNTIME value to PGlite, but
 * TypeScript still resolves the import's type from the real module), and the
 * PGlite-typed `db` returned directly by createTestDb() in this file's own
 * spike test. The concrete driver types aren't mutually assignable, so we
 * accept anything with a compatible .execute().
 */
type ExecutableDb = { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> };

// Derived from the schema module at runtime so a newly added table can never
// be silently missed (a hand-maintained list fails OPEN: an unlisted table
// with no FK chain to a listed one simply never gets truncated, and state
// leaks between tests). TRUNCATE ... CASCADE makes ordering irrelevant.
const CONFIRMATION_TABLES: string[] = Object.values(schema)
  .filter((value) => value instanceof PgTable)
  .map((table) => getTableName(table as PgTable));

/**
 * Rows that MIGRATIONS put in the database, captured once immediately after they
 * run and restored by every `resetTestDb`.
 *
 * Without this, `TRUNCATE` would delete migration-delivered reference data — the
 * seeded `workflow_stages` and their tasks — so the first test in a file would
 * pass and every later one would fail against empty config tables. Restoring
 * also undoes any mutation a test makes to that config (deactivating a stage,
 * say), which would otherwise leak into the tests that follow.
 *
 * Captured by *observation* rather than a hand-maintained list of seeded tables:
 * straight after migrating, any table with rows in it was seeded by a migration,
 * by definition. A future migration that seeds something new is picked up with no
 * change here.
 */
let migrationSeededRows: { table: string; json: string }[] = [];

/** PGlite and postgres-js disagree on the result shape; accept either. */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) return result[0] as Record<string, unknown> | undefined;
  const rows = (result as { rows?: unknown[] })?.rows;
  return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
}

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });

  migrationSeededRows = [];
  for (const table of CONFIRMATION_TABLES) {
    const result = await db.execute(
      sql.raw(
        `SELECT coalesce(json_agg(t), '[]'::json)::text AS data FROM "confirmation"."${table}" t`,
      ),
    );
    const data = firstRow(result)?.data;
    if (typeof data === 'string' && data !== '[]') {
      migrationSeededRows.push({ table, json: data });
    }
  }

  return {
    db,
    async teardown() {
      await client.close();
    },
  };
}

export async function resetTestDb(db: ExecutableDb) {
  const tables = CONFIRMATION_TABLES.map((t) => `"confirmation"."${t}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables} CASCADE`));

  // Put migration-seeded reference data back, in capture order so a child table
  // never lands before its parent. json_populate_recordset maps by column name,
  // so this survives a later migration adding a column.
  for (const { table, json } of migrationSeededRows) {
    const literal = json.replace(/'/g, "''");
    await db.execute(
      sql.raw(
        `INSERT INTO "confirmation"."${table}" SELECT * FROM ` +
          `json_populate_recordset(null::"confirmation"."${table}", '${literal}')`,
      ),
    );
  }
}
