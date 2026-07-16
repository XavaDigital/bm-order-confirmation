/**
 * Test-only PGlite-backed database. Never imported by production code — used
 * exclusively via vi.mock('@/db', ...) in *.integration.test.ts files so that
 * service modules (which import { db } from '@/db') transparently run against
 * an in-process Postgres instead of a real one.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
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

const CONFIRMATION_TABLES = [
  'rate_limits',
  'domain_events',
  'conversion_events',
  'confirmations',
  'acknowledgments',
  'garment_size_chart_links',
  'size_charts',
  'mockup_images',
  'garment_sizing',
  'roster_members',
  'roster_access',
  'garments',
  'order_access',
  'orders',
  'staff_users',
] as const;

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });

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
}
