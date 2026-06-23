import { db } from '@/db';
import { orders } from '@/db/schema';
import { count } from 'drizzle-orm';
import { DashboardView } from './DashboardView';

async function getOrderCounts() {
  const rows = await db
    .select({ status: orders.status, count: count() })
    .from(orders)
    .groupBy(orders.status);

  const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  return {
    draft: map.draft ?? 0,
    sent: map.sent ?? 0,
    viewed: map.viewed ?? 0,
    confirmed: map.confirmed ?? 0,
    total: rows.reduce((sum, r) => sum + Number(r.count), 0),
  };
}

export default async function DashboardPage() {
  const counts = await getOrderCounts();
  return <DashboardView counts={counts} />;
}
