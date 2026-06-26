import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders, staffUsers } from '@/db/schema';
import { env } from '@/lib/env';
import { sendStaffConfirmationEmail, isEmailConfigured } from '@/lib/email';

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
  });
}
