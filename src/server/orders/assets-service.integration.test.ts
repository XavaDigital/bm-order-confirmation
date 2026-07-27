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
import { createOrderSchema } from './contract';
import { createOrder, duplicateOrder, getOrderAdmin } from './service';
import {
  createOrderAsset,
  deleteOrderAsset,
  listOrderAssets,
  loadPoAssets,
  updateOrderAsset,
} from './assets-service';

afterEach(async () => {
  await resetTestDb(db);
});

function minimalInput(overrides: Record<string, unknown> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

async function seedOrder() {
  const created = await createOrder(minimalInput());
  const order = await getOrderAdmin(created.orderId);
  return { orderId: created.orderId, garmentId: order!.garments[0].id };
}

const designAsset = {
  kind: 'design' as const,
  name: 'Front print AI',
  url: 'https://drive.google.com/file/d/abc',
  includeOnPo: false,
};

describe('order assets', () => {
  it('creates an order-wide asset and lists it', async () => {
    const { orderId } = await seedOrder();

    const asset = await createOrderAsset(orderId, designAsset, { actorEmail: 'staff@x.com' });

    expect(asset.garmentId).toBeNull();
    expect(asset.sortOrder).toBe(0);
    const listed = await listOrderAssets(orderId);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Front print AI');
  });

  it('records an audit row on the order aggregate', async () => {
    const { orderId } = await seedOrder();

    await createOrderAsset(orderId, designAsset, { actorEmail: 'staff@x.com' });

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, orderId));
    const added = events.find((e) => e.eventType === 'asset.added');
    expect(added).toBeDefined();
    expect(added!.actorEmail).toBe('staff@x.com');
  });

  it('tags an asset to a garment of the same order', async () => {
    const { orderId, garmentId } = await seedOrder();

    const asset = await createOrderAsset(orderId, { ...designAsset, garmentId }, {});

    expect(asset.garmentId).toBe(garmentId);
    const listed = await listOrderAssets(orderId);
    expect(listed[0].garment?.name).toBe('Home Jersey');
  });

  // Otherwise a tag would leak another order's garment name onto this order's
  // purchase orders.
  it('refuses a garment belonging to a different order', async () => {
    const { orderId } = await seedOrder();
    const other = await seedOrder();

    await expect(
      createOrderAsset(orderId, { ...designAsset, garmentId: other.garmentId }, {}),
    ).rejects.toThrow('does not belong to this order');
  });

  it('appends each new asset after the last', async () => {
    const { orderId } = await seedOrder();

    await createOrderAsset(orderId, designAsset, {});
    const second = await createOrderAsset(
      orderId,
      { ...designAsset, name: 'Club font', kind: 'font' },
      {},
    );

    expect(second.sortOrder).toBe(1);
  });

  it('updates fields and clears notes with an explicit null', async () => {
    const { orderId } = await seedOrder();
    const asset = await createOrderAsset(orderId, { ...designAsset, notes: 'v1' }, {});

    const updated = await updateOrderAsset(asset.id, { name: 'Front print v2', notes: null }, {});

    expect(updated.name).toBe('Front print v2');
    expect(updated.notes).toBeNull();
  });

  it('deletes an asset and audits it', async () => {
    const { orderId } = await seedOrder();
    const asset = await createOrderAsset(orderId, designAsset, {});

    await deleteOrderAsset(asset.id, { actorEmail: 'staff@x.com' });

    expect(await listOrderAssets(orderId)).toHaveLength(0);
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.aggregateId, orderId));
    expect(events.some((e) => e.eventType === 'asset.removed')).toBe(true);
  });

  it('throws NotFoundError for an unknown asset or order', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000';
    await expect(updateOrderAsset(unknown, { name: 'x' }, {})).rejects.toThrow('Asset not found');
    await expect(createOrderAsset(unknown, designAsset, {})).rejects.toThrow('Order not found');
  });

  it('deletes assets when their garment goes (FK cascade)', async () => {
    const { orderId, garmentId } = await seedOrder();
    await createOrderAsset(orderId, { ...designAsset, garmentId }, {});

    await db.delete(schema.garments).where(eq(schema.garments.id, garmentId));

    expect(await listOrderAssets(orderId)).toHaveLength(0);
  });
});

describe('loadPoAssets', () => {
  // Off by default: an internal working file is not automatically factory-facing.
  it('returns only assets flagged includeOnPo', async () => {
    const { orderId, garmentId } = await seedOrder();
    await createOrderAsset(orderId, designAsset, {}); // includeOnPo false
    await createOrderAsset(
      orderId,
      { ...designAsset, name: 'Factory artwork', includeOnPo: true, garmentId },
      {},
    );

    const forPo = await loadPoAssets(orderId);

    expect(forPo).toHaveLength(1);
    expect(forPo[0].name).toBe('Factory artwork');
    // Garment name denormalized so a regenerated PDF doesn't depend on the
    // garment still existing.
    expect(forPo[0].garmentName).toBe('Home Jersey');
  });

  it('returns [] when nothing is flagged', async () => {
    const { orderId } = await seedOrder();
    await createOrderAsset(orderId, designAsset, {});

    expect(await loadPoAssets(orderId)).toEqual([]);
  });
});

describe('reprints', () => {
  it('records the source order and reason on a reprint', async () => {
    const { orderId } = await seedOrder();

    const reprint = await duplicateOrder(orderId, undefined, {
      reprint: true,
      reprintReason: 'Customer reordering same kit',
      actorEmail: 'staff@x.com',
    });

    const [row] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, reprint.orderId));
    expect(row.sourceOrderId).toBe(orderId);
    expect(row.reprintReason).toBe('Customer reordering same kit');
  });

  // A plain duplicate must never claim to be a reprint.
  it('records nothing when duplicating without the reprint flag', async () => {
    const { orderId } = await seedOrder();

    const dup = await duplicateOrder(orderId);

    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, dup.orderId));
    expect(row.sourceOrderId).toBeNull();
    expect(row.reprintReason).toBeNull();
  });

  it('emits order.reprint_created for a reprint and order.duplicated otherwise', async () => {
    const { orderId } = await seedOrder();

    const reprint = await duplicateOrder(orderId, undefined, { reprint: true });
    const plain = await duplicateOrder(orderId);

    const events = await db.select().from(schema.domainEvents);
    const forReprint = events.find((e) => e.aggregateId === reprint.orderId);
    const forPlain = events.find((e) => e.aggregateId === plain.orderId);
    expect(forReprint!.eventType).toBe('order.reprint_created');
    expect(forPlain!.eventType).toBe('order.duplicated');
  });

  it('carries design and font links onto the copy', async () => {
    const { orderId, garmentId } = await seedOrder();
    await createOrderAsset(orderId, { ...designAsset, includeOnPo: true, garmentId }, {});
    await createOrderAsset(orderId, { ...designAsset, name: 'Club font', kind: 'font' }, {});

    const reprint = await duplicateOrder(orderId, undefined, { reprint: true });

    const copied = await listOrderAssets(reprint.orderId);
    expect(copied.map((a) => a.name).sort()).toEqual(['Club font', 'Front print AI']);
    expect(copied.find((a) => a.name === 'Front print AI')!.includeOnPo).toBe(true);
    // The tag pointed at the SOURCE order's garment, so it becomes order-wide
    // on the copy rather than dangling.
    expect(copied.every((a) => a.garmentId === null)).toBe(true);
  });

  it('nulls the link rather than deleting the reprint if the source is deleted', async () => {
    const { orderId } = await seedOrder();
    const reprint = await duplicateOrder(orderId, undefined, { reprint: true });

    await db.delete(schema.orders).where(eq(schema.orders.id, orderId));

    const [row] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, reprint.orderId));
    expect(row).toBeDefined();
    expect(row.sourceOrderId).toBeNull();
  });
});
