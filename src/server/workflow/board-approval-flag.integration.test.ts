/**
 * The awaiting-approval FLAG on the Kanban card (David, 2026-08-06).
 *
 * board.ts carries it as a BOOLEAN rather than the timestamp: the card only has
 * to badge, and the who/when/note live on the PO page one click away. The flag
 * is orthogonal to the column — a waiting PO stays in whatever stage its status
 * puts it in — so that is what this pins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';
import { createPurchaseOrder } from '@/server/purchase-orders/service';
import { getPurchaseOrderBoard, type BoardCard } from './board';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedPo(name: string) {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name, supplierCode: name.slice(0, 2).toUpperCase(), portalPassword: 'fish-tuesday' })
    .returning();
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M' }] }],
    }),
  );
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  }))!;
  return createPurchaseOrder({
    orderId: created.orderId,
    supplierId: supplier.id,
    garmentIds: [garment.id],
  });
}

/** The card for a PO, wherever on the board it landed. */
async function findCard(poId: string): Promise<BoardCard | undefined> {
  const board = await getPurchaseOrderBoard();
  return board.columns.flatMap((column) => column.cards).find((card) => card.id === poId);
}

describe('getPurchaseOrderBoard — awaiting approval', () => {
  it('flags the card of a purchase order that is waiting on us', async () => {
    const po = await seedPo('Dynasty');
    await db
      .update(schema.purchaseOrders)
      .set({ awaitingApprovalAt: new Date(), awaitingApprovalBy: 'Ana (Dynasty)' })
      .where(eq(schema.purchaseOrders.id, po.id));

    expect((await findCard(po.id))?.awaitingApproval).toBe(true);
  });

  it('leaves the card unflagged while nothing has been submitted', async () => {
    const po = await seedPo('Vast');

    expect((await findCard(po.id))?.awaitingApproval).toBe(false);
  });

  // The flag says whose court the ball is in; it does not move the job.
  it('does not change which column the card sits in', async () => {
    const po = await seedPo('Dynasty');
    const before = await getPurchaseOrderBoard();
    const beforeColumn = before.columns.find((c) => c.cards.some((card) => card.id === po.id))!;

    await db
      .update(schema.purchaseOrders)
      .set({ awaitingApprovalAt: new Date() })
      .where(eq(schema.purchaseOrders.id, po.id));

    const after = await getPurchaseOrderBoard();
    const afterColumn = after.columns.find((c) => c.cards.some((card) => card.id === po.id))!;
    expect(afterColumn.slug).toBe(beforeColumn.slug);
  });
});
