/**
 * Required garment-type options (David, 2026-08-06: "the sales person MUST
 * choose a colour for the cord of the shorts") — server-side enforcement:
 * staff createOrder / addGarment / updateGarment 409 while a VISIBLE required
 * option is unanswered; platform creates are exempt; createPurchaseOrder is
 * the backstop that names the per-garment gaps.
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
import { createOrderSchema } from './contract';
import { addGarment, createOrder, updateGarment, ConflictError } from './service';
import { createGarmentType } from '@/server/garment-types/service';
import { createGarmentTypeSchema } from '@/server/garment-types/contract';
import { createPurchaseOrder } from '@/server/purchase-orders/service';

afterEach(async () => {
  await resetTestDb(db);
});

/** Shorts type: required cord colour (no default) + required free-text label. */
async function seedShortsType(overrides: Record<string, unknown> = {}) {
  return createGarmentType(
    createGarmentTypeSchema.parse({
      name: 'Team Shorts',
      orderOptions: [
        { label: 'Cord Color', type: 'select', options: ['black', 'white'], required: true },
        { label: 'Waist Label', type: 'text', required: true },
      ],
      ...overrides,
    }),
  );
}

function minimalInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

describe('staff createOrder', () => {
  it('409s naming the garment and the missing labels', async () => {
    const type = await seedShortsType();
    await expect(
      createOrder(
        minimalInput({ garments: [{ name: 'Shorts', garmentTypeId: type.id }] }),
      ),
    ).rejects.toThrow(
      new ConflictError('Garment "Shorts" — required options not set: Cord Color, Waist Label'),
    );
    // The whole create rolled back — no half-order.
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });

  it('passes when the answers are supplied', async () => {
    const type = await seedShortsType();
    const created = await createOrder(
      minimalInput({
        garments: [
          {
            name: 'Shorts',
            garmentTypeId: type.id,
            selectedOptions: { 'Cord Color': 'black', 'Waist Label': 'BM' },
          },
        ],
      }),
    );
    expect(created.orderId).toBeTruthy();
  });
});

describe('platform-source createOrder', () => {
  it('is NOT blocked — the email relay cannot answer preset questions', async () => {
    const type = await seedShortsType();
    const created = await createOrder(
      minimalInput({
        source: 'platform',
        garments: [{ name: 'Shorts', garmentTypeId: type.id }],
      }),
    );
    const garment = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    });
    expect(garment!.garmentTypeId).toBe(type.id);
  });
});

describe('addGarment', () => {
  it('409s with a message listing the missing labels', async () => {
    const type = await seedShortsType();
    const created = await createOrder(minimalInput());

    await expect(
      addGarment(created.orderId, { name: 'Shorts', garmentTypeId: type.id }),
    ).rejects.toThrow(new ConflictError('Required options not set: Cord Color, Waist Label'));

    // Rolled back — the order still has only its original garment.
    const rows = await db.query.garments.findMany({
      where: eq(schema.garments.orderId, created.orderId),
    });
    expect(rows.map((g) => g.name)).toEqual(['Home Jersey']);
  });

  it('passes when the type defaults fill every required option', async () => {
    const type = await seedShortsType({
      orderOptions: [
        {
          label: 'Cord Color',
          type: 'select',
          options: ['black', 'white'],
          defaultOption: 'black',
          required: true,
        },
      ],
    });
    const created = await createOrder(minimalInput());

    const garment = await addGarment(created.orderId, { name: 'Shorts', garmentTypeId: type.id });
    expect(garment.selectedOptions).toEqual({ 'Cord Color': 'black' });
  });

  it('does not require a HIDDEN required option — unmet showWhen chain', async () => {
    const type = await createGarmentType(
      createGarmentTypeSchema.parse({
        name: 'Chained Shorts',
        orderOptions: [
          { label: 'Cords?', type: 'checkbox' },
          {
            label: 'Cord Color',
            type: 'select',
            options: ['black'],
            required: true,
            showWhen: { parentLabel: 'Cords?', equals: ['true'] },
          },
        ],
      }),
    );
    const created = await createOrder(minimalInput());

    const garment = await addGarment(created.orderId, {
      name: 'Shorts',
      garmentTypeId: type.id,
      selectedOptions: { 'Cords?': 'false' },
    });
    expect(garment.selectedOptions).toEqual({ 'Cords?': 'false' });
  });
});

describe('updateGarment', () => {
  it('409s when setting a type whose required options are unanswered', async () => {
    const type = await seedShortsType();
    const created = await createOrder(minimalInput());
    const garment = (await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    }))!;

    await expect(updateGarment(garment.id, { garmentTypeId: type.id })).rejects.toThrow(
      new ConflictError('Required options not set: Cord Color, Waist Label'),
    );
  });

  it('409s when a write empties a required option', async () => {
    const type = await seedShortsType();
    const created = await createOrder(
      minimalInput({
        garments: [
          {
            name: 'Shorts',
            garmentTypeId: type.id,
            selectedOptions: { 'Cord Color': 'black', 'Waist Label': 'BM' },
          },
        ],
      }),
    );
    const garment = (await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    }))!;

    await expect(
      updateGarment(garment.id, {
        selectedOptions: { 'Cord Color': '', 'Waist Label': 'BM' },
      }),
    ).rejects.toThrow(new ConflictError('Required options not set: Cord Color'));
  });

  it('leaves unrelated edits (a rename) unblocked even while a gap exists', async () => {
    const type = await seedShortsType();
    // The gap can only exist on a platform-created garment (staff paths refuse it).
    const created = await createOrder(
      minimalInput({
        source: 'platform',
        garments: [{ name: 'Shorts', garmentTypeId: type.id }],
      }),
    );
    const garment = (await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    }))!;

    await updateGarment(garment.id, { name: 'Shorts V2' });
    const renamed = await db.query.garments.findFirst({
      where: eq(schema.garments.id, garment.id),
    });
    expect(renamed!.name).toBe('Shorts V2');
  });
});

describe('createPurchaseOrder backstop', () => {
  async function seedSupplier() {
    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ name: 'Vast Apparel', supplierCode: 'VA' })
      .returning();
    return supplier;
  }

  it('409s listing the per-garment gaps before any snapshot is cut', async () => {
    const type = await seedShortsType();
    const supplier = await seedSupplier();
    // Platform create is the path that can leave the gap in place.
    const created = await createOrder(
      minimalInput({
        source: 'platform',
        garments: [
          { name: 'Shorts', garmentTypeId: type.id, sizing: [{ size: 'M', playerName: 'Alice' }] },
        ],
      }),
    );
    const garment = (await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    }))!;

    await expect(
      createPurchaseOrder({
        orderId: created.orderId,
        supplierId: supplier.id,
        garmentIds: [garment.id],
      }),
    ).rejects.toThrow(
      new ConflictError('Required options not set — Shorts: Cord Color, Waist Label'),
    );
    expect(await db.select().from(schema.purchaseOrders)).toHaveLength(0);
  });

  it('creates the PO once the gaps are answered', async () => {
    const type = await seedShortsType();
    const supplier = await seedSupplier();
    const created = await createOrder(
      minimalInput({
        garments: [
          {
            name: 'Shorts',
            garmentTypeId: type.id,
            selectedOptions: { 'Cord Color': 'black', 'Waist Label': 'BM' },
            sizing: [{ size: 'M', playerName: 'Alice' }],
          },
        ],
      }),
    );
    const garment = (await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    }))!;

    const po = await createPurchaseOrder({
      orderId: created.orderId,
      supplierId: supplier.id,
      garmentIds: [garment.id],
    });
    expect(po.poNumber).toBe('VA1');
  });
});
