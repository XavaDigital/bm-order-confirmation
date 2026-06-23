import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

// `prepare: false` keeps us compatible with transaction-pooled connections
// (e.g. Supabase's pgBouncer pooler on port 6543).
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };

export type Database = typeof db;
// The transaction handle passed to db.transaction(async (tx) => ...).
// Type-only export, so importing it elsewhere creates no runtime cycle.
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
