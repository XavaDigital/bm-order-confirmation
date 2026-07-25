import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, staffUsers, confirmations } from '@/db/schema';
import { snap } from '@/server/orders/mappers';
import { env } from '@/lib/env';
import {
  sendStaffConfirmationEmail,
  sendStaffChangeRequestEmail,
  sendStaffColorSampleRequestEmail,
  sendCustomerReceiptEmail,
  isEmailConfigured,
} from '@/lib/email';

function staffCc(): string | undefined {
  return env.STAFF_NOTIFICATIONS_CC || undefined;
}

export async function notifyStaffOfChangeRequest(
  orderId: string,
  orderNumber: string,
  comment: string,
): Promise<void> {
  if (!isEmailConfigured()) return;

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order?.createdBy) return;

  const [staff] = await db
    .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name })
    .from(staffUsers)
    .where(eq(staffUsers.id, order.createdBy))
    .limit(1);

  if (!staff) return;

  const adminOrderUrl = `${env.APP_BASE_URL}/admin/orders/${orderId}`;

  await sendStaffChangeRequestEmail({
    to: staff.email,
    toName: staff.name,
    customerName: order.customerName,
    orderNumber,
    comment,
    adminOrderUrl,
    cc: staffCc(),
  });
}

export async function notifyStaffOfColorSampleRequest(
  orderId: string,
  orderNumber: string,
): Promise<void> {
  if (!isEmailConfigured()) return;

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order?.createdBy) return;

  const [staff] = await db
    .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name })
    .from(staffUsers)
    .where(eq(staffUsers.id, order.createdBy))
    .limit(1);

  if (!staff) return;

  const adminOrderUrl = `${env.APP_BASE_URL}/admin/orders/${orderId}`;

  await sendStaffColorSampleRequestEmail({
    to: staff.email,
    toName: staff.name,
    customerName: order.customerName,
    orderNumber,
    adminOrderUrl,
    cc: staffCc(),
  });
}

export async function notifyStaffOfConfirmation(
  orderId: string,
  orderNumber: string,
  confirmedAt: Date,
): Promise<void> {
  if (!isEmailConfigured()) return;

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order?.createdBy) return;

  const [staff] = await db
    .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name })
    .from(staffUsers)
    .where(eq(staffUsers.id, order.createdBy))
    .limit(1);

  if (!staff) return;

  const adminOrderUrl = `${env.APP_BASE_URL}/admin/orders/${orderId}`;

  await sendStaffConfirmationEmail({
    to: staff.email,
    toName: staff.name,
    customerName: order.customerName,
    orderNumber,
    confirmedAt,
    adminOrderUrl,
    colorSampleRequested: order.colorSampleRequestedAt !== null,
    cc: staffCc(),
  });
}

/**
 * Customer's own receipt of what they confirmed. The garment summary is read
 * from the immutable confirmedSnapshot (not live order/garment rows) — that
 * snapshot is the durable record of what was actually agreed to, per
 * schema.ts's note on `confirmations.confirmedSnapshot`.
 */
export async function notifyCustomerOfConfirmation(
  orderId: string,
  orderNumber: string,
  confirmedAt: Date,
): Promise<void> {
  if (!isEmailConfigured()) return;

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return;

  const confirmation = await db.query.confirmations.findFirst({
    where: eq(confirmations.orderId, orderId),
  });
  // New snapshots use camelCase keys; pre-migration rows keep snake_case —
  // snap() resolves either (see buildConfirmationSnapshot in customer-service.ts).
  const snapshot = confirmation?.confirmedSnapshot as Record<string, unknown> | undefined;

  const snapshotGarments = (snapshot?.garments ?? []) as Array<{
    name: string;
    sizing?: unknown[];
  }>;
  const garments = snapshotGarments.map((g) => ({
    name: g.name,
    quantity: Array.isArray(g.sizing) ? g.sizing.length : 0,
  }));

  await sendCustomerReceiptEmail({
    to: order.customerEmail,
    toName: order.customerName,
    orderNumber,
    confirmedAt,
    garments,
    orderValueAmount: snap<string | null>(snapshot, 'orderValueAmount', 'order_value_amount') ?? null,
    orderValueCurrency: snap<string | null>(snapshot, 'orderValueCurrency', 'order_value_currency') ?? null,
    expectedShipDate: snap<string | null>(snapshot, 'expectedShipDate', 'expected_ship_date') ?? null,
  });
}
