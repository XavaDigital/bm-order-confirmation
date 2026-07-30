import { db } from '@/db';
import { orders, purchaseOrders, garments, garmentTypes, auditEvents } from '@/db/schema';
import { count, sum, eq, and, gte, ne, sql, isNotNull } from 'drizzle-orm';

/** Monday-aligned week start, matching Postgres `date_trunc('week', …)`. */
function weekStartOf(d: Date) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0 Sun..6 Sat
  const diff = (day + 6) % 7; // days since Monday
  date.setDate(date.getDate() - diff);
  return date;
}

const TIME_TO_CONFIRM_BUCKETS = ['0-3 days', '4-7 days', '8-14 days', '15-30 days', '30+ days'] as const;

export async function getMetricsData() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const currentWeekStart = weekStartOf(new Date());
  const eightWeeksAgo = new Date(currentWeekStart);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 7 * 7);

  // UTC throughout (construction, fill-in loop, and the SQL side via `at time
  // zone 'utc'` below) rather than local server time: date_trunc('month', …)
  // buckets by the Postgres SESSION timezone, which need not match the app
  // server's — on a non-UTC box the two would silently disagree about which
  // month a confirmation near a month boundary falls into, and every
  // JS-generated bucket key would miss its SQL row.
  const currentMonthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const sixMonthsAgo = new Date(currentMonthStart);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 5); // inclusive of the current month

  // Days between creation and customer confirmation — a proxy for "how long a
  // deal takes to close", reused by both the average stat and the histogram.
  const daysToConfirm = sql`extract(epoch from (${orders.confirmedAt} - ${orders.createdAt})) / 86400`;
  const confirmedWithDate = and(eq(orders.status, 'confirmed'), isNotNull(orders.confirmedAt));

  const [
    countRows,
    valueRow,
    trendRows,
    colorSampleHoldsCountRow,
    avgTimeToConfirmRow,
    timeToConfirmBucketRows,
    pipelineValueWeekRows,
    topClubRows,
    poStatusRows,
    garmentTypeRows,
    sentToConfirmRows,
    conversionValueMonthRows,
  ] = await Promise.all([
    db.select({ status: orders.status, count: count() }).from(orders).groupBy(orders.status),

    // Excludes cancelled orders — a dead deal's value shouldn't inflate the pipeline total.
    db
      .select({ total: sum(orders.orderValueAmount) })
      .from(orders)
      .where(ne(orders.status, 'cancelled'))
      .then((r) => r[0]),

    db
      .select({
        day: sql<string>`date_trunc('day', ${orders.createdAt})::date::text`,
        count: count(),
      })
      .from(orders)
      .where(gte(orders.createdAt, sevenDaysAgo))
      .groupBy(sql`date_trunc('day', ${orders.createdAt})`),

    db
      .select({ count: count() })
      .from(orders)
      .where(isNotNull(orders.colorSampleRequestedAt))
      .then((r) => r[0]),

    db
      .select({ avgDays: sql<string | null>`avg(${daysToConfirm})` })
      .from(orders)
      .where(confirmedWithDate)
      .then((r) => r[0]),

    db
      .select({
        bucket: sql<string>`case
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

    db
      .select({
        week: sql<string>`date_trunc('week', ${orders.createdAt})::date::text`,
        total: sum(orders.orderValueAmount),
      })
      .from(orders)
      .where(and(ne(orders.status, 'cancelled'), gte(orders.createdAt, eightWeeksAgo)))
      .groupBy(sql`date_trunc('week', ${orders.createdAt})`),

    // Top clubs by order count. Falls back to the customer's own name when no
    // club is on file, so solo/individual orders still show up in the ranking.
    db
      .select({
        club: sql<string>`coalesce(${orders.clubName}, ${orders.customerName})`,
        count: count(),
      })
      .from(orders)
      .where(ne(orders.status, 'cancelled'))
      .groupBy(sql`coalesce(${orders.clubName}, ${orders.customerName})`)
      .orderBy(sql`count(*) desc`)
      .limit(8),

    db.select({ status: purchaseOrders.status, count: count() }).from(purchaseOrders).groupBy(purchaseOrders.status),

    // Only typed garments contribute — a free-text "fabrics" garment has no
    // preset name to group by.
    db
      .select({ name: garmentTypes.name, count: count() })
      .from(garments)
      .innerJoin(garmentTypes, eq(garments.garmentTypeId, garmentTypes.id))
      .groupBy(garmentTypes.name)
      .orderBy(sql`count(*) desc`)
      .limit(8),

    // First customer-facing send per confirmed order, for "how long did the
    // customer take to respond" (as opposed to avgTimeToConfirmRow above,
    // which includes internal drafting time before the link ever went out).
    // A resent link only counts its earliest send — a reminder shouldn't
    // reset the clock on how long the customer actually took. 'link.emailed'
    // is recorded via recordAuditEvent (audit_events), not the domain_events
    // outbox — see CLAUDE.md's "Events & audit" split.
    db
      .select({
        aggregateId: auditEvents.aggregateId,
        firstSentAt: sql<Date>`min(${auditEvents.createdAt})`,
        confirmedAt: sql<Date>`max(${orders.confirmedAt})`,
      })
      .from(auditEvents)
      .innerJoin(orders, eq(auditEvents.aggregateId, orders.id))
      .where(and(eq(auditEvents.eventType, 'link.emailed'), confirmedWithDate))
      .groupBy(auditEvents.aggregateId),

    // Value of orders that actually closed, by the month they were confirmed
    // — distinct from pipelineValueWeekRows (all non-cancelled orders by the
    // week they were CREATED, i.e. pipeline in-flow rather than revenue).
    // `at time zone 'utc'` pins the bucketing to UTC regardless of the
    // Postgres session timezone, matching the UTC math used to build
    // currentMonthStart/sixMonthsAgo and the fill-in keys below.
    db
      .select({
        month: sql<string>`date_trunc('month', ${orders.confirmedAt} at time zone 'utc')::date::text`,
        total: sum(orders.orderValueAmount),
      })
      .from(orders)
      .where(and(confirmedWithDate, gte(orders.confirmedAt, sixMonthsAgo)))
      .groupBy(sql`date_trunc('month', ${orders.confirmedAt} at time zone 'utc')`),
  ]);

  const map = Object.fromEntries(countRows.map((r) => [r.status, Number(r.count)]));
  const counts = {
    draft: map.draft ?? 0,
    sent: map.sent ?? 0,
    viewed: map.viewed ?? 0,
    confirmed: map.confirmed ?? 0,
    changesRequested: map.changes_requested ?? 0,
    cancelled: map.cancelled ?? 0,
    total: countRows.reduce((s, r) => s + Number(r.count), 0),
  };

  const totalValueNZD = valueRow?.total ? Number(valueRow.total) : 0;
  const nonCancelledCount = counts.total - counts.cancelled;
  const avgOrderValueNZD = nonCancelledCount > 0 ? totalValueNZD / nonCancelledCount : 0;

  // Of every order that has ever gone out to a customer, what fraction is now
  // confirmed — a current snapshot, not a historical cohort (an order can loop
  // sent -> changes_requested -> sent again before landing on confirmed).
  const everSentCount = counts.sent + counts.viewed + counts.confirmed + counts.changesRequested;
  const confirmationRatePct = everSentCount > 0 ? (counts.confirmed / everSentCount) * 100 : 0;

  // Same denominator as confirmationRatePct — how often a sent order gets
  // kicked back for changes at least once, not just its current status (an
  // order can move past changes_requested back to sent/confirmed).
  const changesRequestedRatePct = everSentCount > 0 ? (counts.changesRequested / everSentCount) * 100 : 0;

  const sentToConfirmDurations = sentToConfirmRows
    .map((r) => (new Date(r.confirmedAt).getTime() - new Date(r.firstSentAt).getTime()) / 86_400_000)
    .filter((days) => Number.isFinite(days) && days >= 0);
  const avgSentToConfirmDays =
    sentToConfirmDurations.length > 0
      ? sentToConfirmDurations.reduce((a, b) => a + b, 0) / sentToConfirmDurations.length
      : null;

  // Fill in all 7 days even if no orders that day
  const trendMap = Object.fromEntries(trendRows.map((r) => [r.day, r.count]));
  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-NZ', { weekday: 'short', month: 'numeric', day: 'numeric' });
    return { date: key, label, count: trendMap[key] ?? 0 };
  });

  const bucketMap = Object.fromEntries(timeToConfirmBucketRows.map((r) => [r.bucket, Number(r.count)]));
  const timeToConfirmBuckets = TIME_TO_CONFIRM_BUCKETS.map((bucket) => ({
    bucket,
    count: bucketMap[bucket] ?? 0,
  }));

  // Fill in all 8 weeks even if no orders that week
  const weekMap = Object.fromEntries(pipelineValueWeekRows.map((r) => [r.week, r.total ? Number(r.total) : 0]));
  const pipelineValueTrend = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - (7 - i) * 7);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-NZ', { month: 'numeric', day: 'numeric' });
    return { week: key, label, valueNZD: weekMap[key] ?? 0 };
  });

  // Fill in all 6 months even if no order was confirmed that month
  const monthMap = Object.fromEntries(
    conversionValueMonthRows.map((r) => [r.month, r.total ? Number(r.total) : 0]),
  );
  const conversionValueTrend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(currentMonthStart);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-NZ', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    return { month: key, label, valueNZD: monthMap[key] ?? 0 };
  });

  const topClubs = topClubRows.map((r) => ({ club: r.club, count: Number(r.count) }));

  const poStatusCounts = poStatusRows.map((r) => ({ status: r.status as string, count: Number(r.count) }));

  const garmentTypePopularity = garmentTypeRows.map((r) => ({ name: r.name, count: Number(r.count) }));

  return {
    counts,
    totalValueNZD,
    avgOrderValueNZD,
    confirmationRatePct,
    changesRequestedRatePct,
    avgTimeToConfirmDays: avgTimeToConfirmRow?.avgDays ? Number(avgTimeToConfirmRow.avgDays) : null,
    avgSentToConfirmDays,
    trend,
    colorSampleHoldsCount: Number(colorSampleHoldsCountRow?.count ?? 0),
    timeToConfirmBuckets,
    pipelineValueTrend,
    conversionValueTrend,
    topClubs,
    poStatusCounts,
    garmentTypePopularity,
  };
}
