import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/lib/env';
import * as schema from './schema';

// `prepare: false` keeps us compatible with transaction-pooled connections
// (e.g. Supabase's pgBouncer pooler on port 6543).
//
// `max`/`idle_timeout`: pages like the metrics and home dashboards fire a
// dozen-odd independent aggregate queries in one Promise.all. postgres.js's
// default pool (max: 10) is smaller than that fan-out, so the overflow
// queries queue for a connection; under any pooler-side pressure (e.g. a dev
// box that's been through several restarts leaving orphaned connections
// behind) queued statements can get cancelled outright rather than just wait
// — which surfaces as "the page does nothing" rather than a visible error,
// since the failure is a rejected Promise.all rethrown from a Server
// Component. `idle_timeout` releases connections back to the pooler once a
// burst subsides instead of holding them open indefinitely.
const client = postgres(env.DATABASE_URL, { prepare: false, max: 20, idle_timeout: 20 });

export const db = drizzle(client, { schema });
export { schema };

export type Database = typeof db;
// The transaction handle passed to db.transaction(async (tx) => ...).
// Type-only export, so importing it elsewhere creates no runtime cycle.
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
