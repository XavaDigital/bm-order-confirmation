/**
 * Ownership checks shared by the order sub-services (assets, notes, …).
 *
 * These exist as one module because each sub-service needs the same question
 * answered — "does this child row really belong to that order?" — and a second
 * copy of that check is a second chance to get it wrong.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { garments, orders } from '@/db/schema';
import { ConflictError, NotFoundError } from './service';

/** Assert the order exists, without loading the whole tree. */
export async function assertOrderExists(orderId: string): Promise<void> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true },
  });
  if (!order) throw new NotFoundError('Order');
}

/**
 * A referenced garment must belong to the same order. Without this, a caller
 * could tag another order's garment — leaking its name onto this order's
 * purchase orders, or writing into another order's note thread.
 */
export async function assertGarmentBelongsToOrder(
  orderId: string,
  garmentId: string,
): Promise<void> {
  const garment = await db.query.garments.findFirst({
    where: and(eq(garments.id, garmentId), eq(garments.orderId, orderId)),
    columns: { id: true },
  });
  if (!garment) throw new ConflictError('That garment does not belong to this order');
}
