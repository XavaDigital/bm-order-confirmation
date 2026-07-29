import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './src/db/schema.ts';
import { count, sum, eq, and, gte, ne, sql, isNotNull } from 'drizzle-orm';
import { config } from 'dotenv';
config({ path: '.env.local' });

const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 5 });
const db = drizzle(client, { schema });
const { orders, purchaseOrders, garments, garmentTypes } = schema;

function weekStartOf(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  return date;
}

async function run(label, fn) {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT after 10s')), 10000)),
    ]);
    console.log(`[OK ${Date.now() - start}ms]`, label, JSON.stringify(result).slice(0, 200));
  } catch (err) {
    console.log(`[FAIL ${Date.now() - start}ms]`, label, err.message);
  }
}

const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
sevenDaysAgo.setHours(0, 0, 0, 0);

const currentWeekStart = weekStartOf(new Date());
const eightWeeksAgo = new Date(currentWeekStart);
eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 7 * 7);

const daysToConfirm = sql`extract(epoch from (${orders.confirmedAt} - ${orders.createdAt})) / 86400`;
const confirmedWithDate = and(eq(orders.status, 'confirmed'), isNotNull(orders.confirmedAt));

await run('countRows', () => db.select({ status: orders.status, count: count() }).from(orders).groupBy(orders.status));
await run('valueRow', () => db.select({ total: sum(orders.orderValueAmount) }).from(orders).where(ne(orders.status, 'cancelled')));
await run('trendRows', () =>
  db
    .select({ day: sql`date_trunc('day', ${orders.createdAt})::date::text`, count: count() })
    .from(orders)
    .where(gte(orders.createdAt, sevenDaysAgo))
    .groupBy(sql`date_trunc('day', ${orders.createdAt})`),
);
await run('colorSampleHoldsCountRow', () =>
  db.select({ count: count() }).from(orders).where(isNotNull(orders.colorSampleRequestedAt)),
);
await run('avgTimeToConfirmRow', () =>
  db.select({ avgDays: sql`avg(${daysToConfirm})` }).from(orders).where(confirmedWithDate),
);
await run('timeToConfirmBucketRows', () =>
  db
    .select({
      bucket: sql`case
        when ${daysToConfirm} <= 3 then '0-3 days'
        when ${daysToConfirm} <= 7 then '4-7 days'
        when ${daysToConfirm} <= 14 then '8-14 days'
        when ${daysToConfirm} <= 30 then '15-30 days'
        else '30+ days'
      end`,
      count: count(),
    })
    .from(orders)
    .where(confirmedWithDate)
    .groupBy(sql`1`),
);
await run('pipelineValueWeekRows', () =>
  db
    .select({ week: sql`date_trunc('week', ${orders.createdAt})::date::text`, total: sum(orders.orderValueAmount) })
    .from(orders)
    .where(and(ne(orders.status, 'cancelled'), gte(orders.createdAt, eightWeeksAgo)))
    .groupBy(sql`date_trunc('week', ${orders.createdAt})`),
);
await run('topClubRows', () =>
  db
    .select({ club: sql`coalesce(${orders.clubName}, ${orders.customerName})`, count: count() })
    .from(orders)
    .where(ne(orders.status, 'cancelled'))
    .groupBy(sql`coalesce(${orders.clubName}, ${orders.customerName})`)
    .orderBy(sql`count(*) desc`)
    .limit(8),
);
await run('poStatusRows', () =>
  db.select({ status: purchaseOrders.status, count: count() }).from(purchaseOrders).groupBy(purchaseOrders.status),
);
await run('garmentTypeRows', () =>
  db
    .select({ name: garmentTypes.name, count: count() })
    .from(garments)
    .innerJoin(garmentTypes, eq(garments.garmentTypeId, garmentTypes.id))
    .groupBy(garmentTypes.name)
    .orderBy(sql`count(*) desc`)
    .limit(8),
);

console.log('=== now running them all in parallel via Promise.all (like page.tsx) ===');
const start = Date.now();
try {
  await Promise.race([
    Promise.all([
      db.select({ status: orders.status, count: count() }).from(orders).groupBy(orders.status),
      db.select({ total: sum(orders.orderValueAmount) }).from(orders).where(ne(orders.status, 'cancelled')),
      db
        .select({ day: sql`date_trunc('day', ${orders.createdAt})::date::text`, count: count() })
        .from(orders)
        .where(gte(orders.createdAt, sevenDaysAgo))
        .groupBy(sql`date_trunc('day', ${orders.createdAt})`),
      db.select({ count: count() }).from(orders).where(isNotNull(orders.colorSampleRequestedAt)),
      db.select({ avgDays: sql`avg(${daysToConfirm})` }).from(orders).where(confirmedWithDate),
      db
        .select({
          bucket: sql`case when ${daysToConfirm} <= 3 then '0-3 days' else '30+ days' end`,
          count: count(),
        })
        .from(orders)
        .where(confirmedWithDate)
        .groupBy(sql`1`),
      db
        .select({ week: sql`date_trunc('week', ${orders.createdAt})::date::text`, total: sum(orders.orderValueAmount) })
        .from(orders)
        .where(and(ne(orders.status, 'cancelled'), gte(orders.createdAt, eightWeeksAgo)))
        .groupBy(sql`date_trunc('week', ${orders.createdAt})`),
      db
        .select({ club: sql`coalesce(${orders.clubName}, ${orders.customerName})`, count: count() })
        .from(orders)
        .where(ne(orders.status, 'cancelled'))
        .groupBy(sql`coalesce(${orders.clubName}, ${orders.customerName})`)
        .orderBy(sql`count(*) desc`)
        .limit(8),
      db.select({ status: purchaseOrders.status, count: count() }).from(purchaseOrders).groupBy(purchaseOrders.status),
      db
        .select({ name: garmentTypes.name, count: count() })
        .from(garments)
        .innerJoin(garmentTypes, eq(garments.garmentTypeId, garmentTypes.id))
        .groupBy(garmentTypes.name)
        .orderBy(sql`count(*) desc`)
        .limit(8),
    ]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('PARALLEL TIMEOUT after 15s')), 15000)),
  ]);
  console.log(`[OK ${Date.now() - start}ms] all in parallel`);
} catch (err) {
  console.log(`[FAIL ${Date.now() - start}ms] all in parallel:`, err.message);
}

await client.end();
process.exit(0);
