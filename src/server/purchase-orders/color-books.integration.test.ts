/**
 * Colour-book resolution on purchase orders (David, 2026-08-05).
 *
 * createPurchaseOrder: an explicit colorBookId must belong to THIS supplier
 * (else 409 — never a silent cross-link); omitted picks the supplier's newest
 * book; a supplier with no books yields null. The id AND the denormalized
 * name are stamped together. updatePurchaseOrder: null clears both fields, an
 * id re-resolves and re-validates.
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
import { createColorBook } from '@/server/suppliers/service';
import { resolveSupplierPoViewByNumber } from '@/server/supplier-portal/service';
import {
  createPurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
} from './service';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedSupplier(name = 'Dynasty', code = 'DY') {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name, supplierCode: code })
    .returning();
  return supplier;
}

async function seedOrder() {
  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Team Hoodie', sizing: [{ size: 'M', playerName: 'Alice' }] }],
    }),
  );
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  }))!;
  return { orderId: created.orderId, garmentId: garment.id };
}

/** Two books with deterministic ages: returns [older, newer]. */
async function seedBooks(supplierId: string) {
  const older = await createColorBook(supplierId, '2025 Book');
  await db
    .update(schema.supplierColorBooks)
    .set({ createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
    .where(eq(schema.supplierColorBooks.id, older.id));
  const newer = await createColorBook(supplierId, '2026 Book');
  return { older, newer };
}

describe('createPurchaseOrder colour-book resolution', () => {
  it('a supplier with no books yields null id and name', async () => {
    const supplier = await seedSupplier();
    const { orderId, garmentId } = await seedOrder();

    const po = await createPurchaseOrder({ orderId, supplierId: supplier.id, garmentIds: [garmentId] });

    expect(po.colorBookId).toBeNull();
    expect(po.colorBookName).toBeNull();
  });

  it('omitted colorBookId defaults to the supplier’s NEWEST book, id and name together', async () => {
    const supplier = await seedSupplier();
    const { newer } = await seedBooks(supplier.id);
    const { orderId, garmentId } = await seedOrder();

    const po = await createPurchaseOrder({ orderId, supplierId: supplier.id, garmentIds: [garmentId] });

    expect(po.colorBookId).toBe(newer.id);
    expect(po.colorBookName).toBe('2026 Book');
  });

  it('adding a newer book changes the default for the NEXT po only', async () => {
    const supplier = await seedSupplier();
    const { newer } = await seedBooks(supplier.id);
    const { orderId, garmentId } = await seedOrder();

    const first = await createPurchaseOrder({ orderId, supplierId: supplier.id, garmentIds: [garmentId] });
    expect(first.colorBookName).toBe('2026 Book');

    // The 2027 edition arrives. Existing POs keep their book; new ones get it.
    await createColorBook(supplier.id, '2027 Book');
    const second = await createPurchaseOrder({ orderId, supplierId: supplier.id, garmentIds: [garmentId] });

    expect(second.colorBookName).toBe('2027 Book');
    const firstRow = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, first.id),
    });
    expect(firstRow!.colorBookId).toBe(newer.id);
  });

  it('an explicit id picks that book — a reprint can use an older edition', async () => {
    const supplier = await seedSupplier();
    const { older } = await seedBooks(supplier.id);
    const { orderId, garmentId } = await seedOrder();

    const po = await createPurchaseOrder({
      orderId,
      supplierId: supplier.id,
      garmentIds: [garmentId],
      colorBookId: older.id,
    });

    expect(po.colorBookId).toBe(older.id);
    expect(po.colorBookName).toBe('2025 Book');
  });

  it('another supplier’s book id is a 409 and creates nothing', async () => {
    const supplier = await seedSupplier();
    const rival = await seedSupplier('Goal Sports', 'GOAL');
    const rivalBook = await createColorBook(rival.id, 'Rival Book');
    const { orderId, garmentId } = await seedOrder();

    await expect(
      createPurchaseOrder({
        orderId,
        supplierId: supplier.id,
        garmentIds: [garmentId],
        colorBookId: rivalBook.id,
      }),
    ).rejects.toThrow('That colour book does not belong to this supplier');

    expect(await db.query.purchaseOrders.findMany()).toHaveLength(0);
  });
});

describe('updatePurchaseOrder colorBookId', () => {
  async function seedPo() {
    const supplier = await seedSupplier();
    const books = await seedBooks(supplier.id);
    const { orderId, garmentId } = await seedOrder();
    const po = await createPurchaseOrder({ orderId, supplierId: supplier.id, garmentIds: [garmentId] });
    return { supplier, po, ...books };
  }

  it('null clears BOTH the id and the denormalized name', async () => {
    const { po } = await seedPo();
    expect(po.colorBookId).not.toBeNull();

    const updated = await updatePurchaseOrder(po.id, { colorBookId: null });

    expect(updated.colorBookId).toBeNull();
    expect(updated.colorBookName).toBeNull();
  });

  it('an id re-resolves the pair; omitting the field leaves it untouched', async () => {
    const { po, older, newer } = await seedPo();

    const updated = await updatePurchaseOrder(po.id, { colorBookId: older.id });
    expect(updated.colorBookId).toBe(older.id);
    expect(updated.colorBookName).toBe('2025 Book');

    // A patch that says nothing about the book must not disturb it.
    const untouched = await updatePurchaseOrder(po.id, { notes: 'unrelated edit' });
    expect(untouched.colorBookId).toBe(older.id);
    expect(untouched.colorBookName).toBe('2025 Book');
    expect(newer.id).not.toBe(older.id);
  });

  it('rejects another supplier’s book id without changing the row', async () => {
    const { po, newer } = await seedPo();
    const rival = await seedSupplier('Goal Sports', 'GOAL');
    const rivalBook = await createColorBook(rival.id, 'Rival Book');

    await expect(updatePurchaseOrder(po.id, { colorBookId: rivalBook.id })).rejects.toThrow(
      'That colour book does not belong to this supplier',
    );

    const row = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, po.id),
    });
    expect(row!.colorBookId).toBe(newer.id);
  });
});

describe('supplier portal view', () => {
  it('carries colorBookName so the factory sees which book the job matches', async () => {
    const supplier = await seedSupplier();
    await seedBooks(supplier.id);
    const { orderId, garmentId } = await seedOrder();
    const po = await createPurchaseOrder({ orderId, supplierId: supplier.id, garmentIds: [garmentId] });
    await updatePurchaseOrderStatus(po.id, 'sent');

    const view = await resolveSupplierPoViewByNumber(supplier.id, po.poNumber);

    expect(view.colorBookName).toBe('2026 Book');
  });
});
