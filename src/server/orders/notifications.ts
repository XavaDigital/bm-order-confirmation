import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, staffUsers, confirmations } from '@/db/schema';
import { env } from '@/lib/env';
import {
  sendStaffConfirmationEmail,
  sendStaffChangeRequestEmail,
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
  const snapshot = confirmation?.confirmedSnapshot as
    | {
        garments?: Array<{ name: string; sizing?: unknown[] }>;
        order_value_amount?: string | null;
        order_value_currency?: string | null;
        expected_ship_date?: string | null;
      }
    | undefined;

  const garments = (snapshot?.garments ?? []).map((g) => ({
    name: g.name,
    quantity: Array.isArray(g.sizing) ? g.sizing.length : 0,
  }));

  await sendCustomerReceiptEmail({
    to: order.customerEmail,
    toName: order.customerName,
    orderNumber,
    confirmedAt,
    garments,
    orderValueAmount: snapshot?.order_value_amount ?? null,
    orderValueCurrency: snapshot?.order_value_currency ?? null,
    expectedShipDate: snapshot?.expected_ship_date ?? null,
  });
}
