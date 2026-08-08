/**
 * The picture on a kanban card (David, 2026-08-09).
 *
 * The rule is "the first garment in the list", and the interesting cases are
 * the ones where that phrase is ambiguous: the first garment has no image, the
 * purchase order covers only some of the order's garments, or there is nothing
 * to show at all. A card showing a garment the factory was never sent would be
 * worse than a card showing nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

// Signing is an S3 concern; the question here is WHICH image is chosen.
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    getSignedUrl: vi.fn(async (key: string) => `signed:${key}`),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { createPurchaseOrder } from '@/server/purchase-orders/service';
import { getSignedUrl } from '@/lib/storage';
import { orderFeaturedImages, poFeaturedImages } from './featured-images';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(getSignedUrl).mockClear();
});

let seq = 0;

async function seedOrder(garmentNames: string[]) {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: garmentNames.map((name) => ({ name, sizing: [{ size: 'M' }] })),
    }),
  );
  const rows = await db
    .select()
    .from(schema.garments)
    .where(eq(schema.garments.orderId, created.orderId))
    .orderBy(schema.garments.sortOrder, schema.garments.createdAt);
  return { orderId: created.orderId, garments: rows };
}

async function addImage(
  garmentId: string,
  storageKey: string,
  opts: { thumbnail?: string | null; sortOrder?: number } = {},
) {
  await db.insert(schema.mockupImages).values({
    garmentId,
    storageKey,
    thumbnailStorageKey: opts.thumbnail ?? null,
    sortOrder: opts.sortOrder ?? 0,
  });
}

describe('orderFeaturedImages', () => {
  it('takes the first image of the first garment', async () => {
    const { orderId, garments } = await seedOrder(['Home Jersey', 'Away Jersey']);
    await addImage(garments[0].id, 'first.png');
    await addImage(garments[1].id, 'second.png');

    const map = await orderFeaturedImages([orderId]);

    expect(map.get(orderId)).toBe('signed:first.png');
  });

  // Boards show many at once, so the small file wins where there is one.
  it('prefers the thumbnail over the full image', async () => {
    const { orderId, garments } = await seedOrder(['Home Jersey']);
    await addImage(garments[0].id, 'full.png', { thumbnail: 'thumb.png' });

    expect((await orderFeaturedImages([orderId])).get(orderId)).toBe('signed:thumb.png');
  });

  it('respects the order the images are shown in', async () => {
    const { orderId, garments } = await seedOrder(['Home Jersey']);
    await addImage(garments[0].id, 'second.png', { sortOrder: 2 });
    await addImage(garments[0].id, 'first.png', { sortOrder: 1 });

    expect((await orderFeaturedImages([orderId])).get(orderId)).toBe('signed:first.png');
  });

  // A first garment with no artwork yet should not blank the card when a later
  // one would do.
  it('falls through to a later garment when the first has no image', async () => {
    const { orderId, garments } = await seedOrder(['Home Jersey', 'Away Jersey']);
    await addImage(garments[1].id, 'second.png');

    expect((await orderFeaturedImages([orderId])).get(orderId)).toBe('signed:second.png');
  });

  it('returns nothing for an order with no images at all', async () => {
    const { orderId } = await seedOrder(['Home Jersey']);

    expect((await orderFeaturedImages([orderId])).has(orderId)).toBe(false);
  });

  it('keeps orders apart when asked for several', async () => {
    const a = await seedOrder(['A']);
    const b = await seedOrder(['B']);
    await addImage(a.garments[0].id, 'a.png');
    await addImage(b.garments[0].id, 'b.png');

    const map = await orderFeaturedImages([a.orderId, b.orderId]);

    expect(map.get(a.orderId)).toBe('signed:a.png');
    expect(map.get(b.orderId)).toBe('signed:b.png');
  });

  // A board that fails to load is worse than a card with no picture.
  it('drops an image whose link cannot be signed rather than failing', async () => {
    const { orderId, garments } = await seedOrder(['Home Jersey']);
    await addImage(garments[0].id, 'broken.png');
    vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error('storage down'));

    expect((await orderFeaturedImages([orderId])).has(orderId)).toBe(false);
  });

  it('asks for nothing when given no orders', async () => {
    expect((await orderFeaturedImages([])).size).toBe(0);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

describe('poFeaturedImages', () => {
  async function seedPo(orderId: string, garmentIds: string[]) {
    seq += 1;
    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: `Dynasty ${seq}`, supplierCode: `D${seq}`, email: `d${seq}@example.com` })
      .returning();
    return createPurchaseOrder({ orderId, supplierId: supplier.id, garmentIds });
  }

  it('takes the first garment ON THE PURCHASE ORDER, not on the order', async () => {
    const { orderId, garments } = await seedOrder(['Home Jersey', 'Away Jersey']);
    await addImage(garments[0].id, 'home.png');
    await addImage(garments[1].id, 'away.png');

    // The PO covers only the SECOND garment.
    const po = await seedPo(orderId, [garments[1].id]);

    expect((await poFeaturedImages([po.id])).get(po.id)).toBe('signed:away.png');
  });

  it('prefers the thumbnail', async () => {
    const { orderId, garments } = await seedOrder(['Home Jersey']);
    await addImage(garments[0].id, 'full.png', { thumbnail: 'thumb.png' });
    const po = await seedPo(orderId, [garments[0].id]);

    expect((await poFeaturedImages([po.id])).get(po.id)).toBe('signed:thumb.png');
  });

  it('returns nothing when no garment on the purchase order has an image', async () => {
    const { orderId, garments } = await seedOrder(['Home Jersey']);
    const po = await seedPo(orderId, [garments[0].id]);

    expect((await poFeaturedImages([po.id])).has(po.id)).toBe(false);
  });

  it('asks for nothing when given no purchase orders', async () => {
    expect((await poFeaturedImages([])).size).toBe(0);
  });
});
