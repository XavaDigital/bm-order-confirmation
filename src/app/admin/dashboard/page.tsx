import { db } from '@/db';
import { orders } from '@/db/schema';
import { count, sum, desc, gte, sql } from 'drizzle-orm';
import { DashboardView } from './DashboardView';

async function getDashboardData() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const [countRows, valueRow, recentRows, trendRows] = await Promise.all([
    db.select({ status: orders.status, count: count() }).from(orders).groupBy(orders.status),

    db
      .select({ total: sum(orders.orderValueAmount) })
      .from(orders)
      .then((r) => r[0]),

    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        clubName: orders.clubName,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .orderBy(desc(orders.createdAt))
      .limit(8),

    db
      .select({
        day: sql<string>`date_trunc('day', ${orders.createdAt})::date::text`,
        count: count(),
      })
      .from(orders)
      .where(gte(orders.createdAt, sevenDaysAgo))
      .groupBy(sql`date_trunc('day', ${orders.createdAt})`),
  ]);

  const map = Object.fromEntries(countRows.map((r) => [r.status, Number(r.count)]));
  const counts = {
    draft: map.draft ?? 0,
    sent: map.sent ?? 0,
    viewed: map.viewed ?? 0,
    confirmed: map.confirmed ?? 0,
    changesRequested: map.changes_requested ?? 0,
    total: countRows.reduce((s, r) => s + Number(r.count), 0),
  };

  // Fill in all 7 days even if no orders that day
  const trendMap = Object.fromEntries(trendRows.map((r) => [r.day, r.count]));
  const trend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-NZ', { weekday: 'short', month: 'numeric', day: 'numeric' });
    return { date: key, label, count: trendMap[key] ?? 0 };
  });

  return {
    counts,
    totalValueNZD: valueRow?.total ? Number(valueRow.total) : 0,
    recentOrders: recentRows.map((o) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
    })),
    trend,
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  return <DashboardView {...data} />;
}
