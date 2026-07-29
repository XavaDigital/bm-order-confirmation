import { db } from '@/db';
import { orders, purchaseOrders } from '@/db/schema';
import { count, desc, asc, and, gte, lte, inArray, isNotNull } from 'drizzle-orm';
import { getStaleOrders } from '@/server/orders/service';
import { findStuckEntities } from '@/server/workflow/board';
import { listFailedEvents } from '@/server/events/processor';
import { getSession } from '@/lib/session';
import { HomeView } from './HomeView';

const DEADLINE_LOOKAHEAD_DAYS = 14;

async function getHomeData() {
  const deadlineCutoff = new Date();
  deadlineCutoff.setDate(deadlineCutoff.getDate() + DEADLINE_LOOKAHEAD_DAYS);
  const deadlineCutoffDate = deadlineCutoff.toISOString().slice(0, 10);

  const [countRows, recentRows, staleOrders, upcomingDeadlineRows, colorSampleHoldRows] = await Promise.all([
    db.select({ status: orders.status, count: count() }).from(orders).groupBy(orders.status),

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

    getStaleOrders(),

    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        clubName: orders.clubName,
        status: orders.status,
        deadlineDate: orders.deadlineDate,
        expectedShipDate: orders.expectedShipDate,
      })
      .from(orders)
      .where(
        and(
          lte(orders.deadlineDate, deadlineCutoffDate),
          inArray(orders.status, ['sent', 'viewed', 'changes_requested']),
        ),
      )
      .orderBy(asc(orders.deadlineDate))
      .limit(10),

    // Orders where the customer asked for a colour book / physical sample and
    // it hasn't been resolved by staff yet — production must hold on these.
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        clubName: orders.clubName,
        status: orders.status,
        colorSampleRequestedAt: orders.colorSampleRequestedAt,
      })
      .from(orders)
      .where(isNotNull(orders.colorSampleRequestedAt))
      .orderBy(asc(orders.colorSampleRequestedAt))
      .limit(10),
  ]);

  const map = Object.fromEntries(countRows.map((r) => [r.status, Number(r.count)]));
  const counts = {
    sent: map.sent ?? 0,
    viewed: map.viewed ?? 0,
    changesRequested: map.changes_requested ?? 0,
  };

  // Work waiting on US, as opposed to staleOrders (waiting on the customer).
  // Both boards, newest pain first, with the parent order resolved so the row
  // can link somewhere useful.
  const [stuckOrders, stuckPos] = await Promise.all([
    findStuckEntities('order'),
    findStuckEntities('purchase_order'),
  ]);
  const poOrderIds =
    stuckPos.length > 0
      ? await db
          .select({ id: purchaseOrders.id, orderId: purchaseOrders.orderId })
          .from(purchaseOrders)
          .where(inArray(purchaseOrders.id, stuckPos.map((p) => p.entityId)))
      : [];
  const orderIdByPo = new Map(poOrderIds.map((row) => [row.id, row.orderId]));

  const stuckInProduction = [
    ...stuckOrders.map((entity) => ({ ...entity, orderId: entity.entityId })),
    ...stuckPos.map((entity) => ({
      ...entity,
      orderId: orderIdByPo.get(entity.entityId) ?? null,
    })),
  ]
    .sort((a, b) => b.hoursInStage - a.hoursInStage)
    .slice(0, 10);

  return {
    counts,
    recentOrders: recentRows.map((o) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
    })),
    staleOrders,
    stuckInProduction,
    upcomingDeadlines: upcomingDeadlineRows,
    colorSampleHolds: colorSampleHoldRows.map((o) => ({
      ...o,
      colorSampleRequestedAt: o.colorSampleRequestedAt!.toISOString(),
    })),
  };
}

export default async function HomePage() {
  const session = await getSession();
  const [data, failedEvents] = await Promise.all([
    getHomeData(),
    // Outbox delivery failures are an ops concern — admin only (roadmap 3.1).
    session.role === 'admin' ? listFailedEvents() : Promise.resolve([]),
  ]);
  return (
    <HomeView
      {...data}
      role={session.role}
      failedEvents={failedEvents.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        nextAttemptAt: e.nextAttemptAt ? e.nextAttemptAt.toISOString() : null,
      }))}
    />
  );
}
