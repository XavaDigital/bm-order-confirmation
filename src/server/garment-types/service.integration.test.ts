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
import { createGarmentTypeSchema } from './contract';
import {
  listGarmentTypes,
  getGarmentType,
  createGarmentType,
  updateGarmentType,
} from './service';
import { createOrder, addGarment, updateGarment, duplicateOrder } from '@/server/orders/service';
import { createOrderSchema } from '@/server/orders/contract';

afterEach(async () => {
  await resetTestDb(db);
});

async function seedChart(name: string) {
  const [chart] = await db
    .insert(schema.sizeCharts)
    .values({ name, storageKey: null, description: null })
    .returning();
  return chart;
}

function hoodieInput(overrides: Record<string, unknown> = {}) {
  return createGarmentTypeSchema.parse({
    name: 'Pullover Hoodie',
    category: 'Hoodies',
    fabricOptions: ['Cotton Fleece', 'Poly Fleece'],
    orderOptions: [
      { label: 'Zip Type', type: 'select', options: ['full-zip', 'pullover'], defaultOption: 'pullover' },
      { label: 'Cord Color', type: 'text', defaultValue: 'Black' },
      { label: 'Pocket Style', type: 'select', options: ['kangaroo', 'side-zip'] },
    ],
    sizes: [
      { sizeRange: 'mens', sizes: ['S', 'M', 'L'] },
      { sizeRange: 'womens', sizes: ['8', '10'] },
    ],
    ...overrides,
  });
}

describe('garment-types service', () => {
  it('creates a type with size-chart links and reads it back', async () => {
    const chart = await seedChart('Hoodie Chart');
    const created = await createGarmentType(hoodieInput({ sizeChartIds: [chart.id] }));

    expect(created.name).toBe('Pullover Hoodie');
    expect(created.sizeChartIds).toEqual([chart.id]);
    expect(created.orderOptions).toHaveLength(3);

    const fetched = await getGarmentType(created.id);
    // sizes are chart-owned now — a provided legacy sizes payload is accepted
    // by the contract for API compat but never persisted
    expect(fetched.sizes).toEqual([]);
  });

  it('listGarmentTypes filters to active types when asked', async () => {
    await createGarmentType(hoodieInput({ name: 'Active Type' }));
    const retired = await createGarmentType(hoodieInput({ name: 'Retired Type' }));
    await updateGarmentType(retired.id, { isActive: false });

    const all = await listGarmentTypes();
    const active = await listGarmentTypes({ activeOnly: true });

    expect(all.map((t) => t.name).sort()).toEqual(['Active Type', 'Retired Type']);
    expect(active.map((t) => t.name)).toEqual(['Active Type']);
  });

  it('update replaces size-chart links as a set', async () => {
    const chartA = await seedChart('Chart A');
    const chartB = await seedChart('Chart B');
    const created = await createGarmentType(hoodieInput({ sizeChartIds: [chartA.id] }));

    const updated = await updateGarmentType(created.id, { sizeChartIds: [chartB.id] });
    expect(updated.sizeChartIds).toEqual([chartB.id]);
  });

  it('throws NotFound for an unknown id', async () => {
    await expect(getGarmentType('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      'Garment type not found',
    );
  });
});

describe('orders service + garment types', () => {
  function orderInput(garments: unknown[]) {
    return createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments,
    });
  }

  it('createOrder with a garmentTypeId auto-links the type charts and defaults options', async () => {
    const chart = await seedChart('Hoodie Chart');
    const type = await createGarmentType(hoodieInput({ sizeChartIds: [chart.id] }));

    const created = await createOrder(
      orderInput([
        { name: 'Team Hoodie', garmentTypeId: type.id, selectedOptions: { 'Cord Color': 'Red' } },
      ]),
    );

    const garment = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
      with: { sizeChartLinks: true },
    });

    expect(garment!.garmentTypeId).toBe(type.id);
    // Explicit value wins; select/text defaults fill the rest; no-default options stay unset
    expect(garment!.selectedOptions).toEqual({ 'Zip Type': 'pullover', 'Cord Color': 'Red' });
    expect(garment!.sizeChartLinks.map((l) => l.sizeChartId)).toEqual([chart.id]);
  });

  it('createOrder dedupes explicitly-passed chart ids against the type charts', async () => {
    const chart = await seedChart('Hoodie Chart');
    const type = await createGarmentType(hoodieInput({ sizeChartIds: [chart.id] }));

    const created = await createOrder(
      orderInput([
        { name: 'Team Hoodie', garmentTypeId: type.id, sizeChartIds: [chart.id] },
      ]),
    );

    const garment = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
      with: { sizeChartLinks: true },
    });
    expect(garment!.sizeChartLinks).toHaveLength(1);
  });

  it('createOrder rejects an unknown garmentTypeId', async () => {
    await expect(
      createOrder(
        orderInput([
          { name: 'Hoodie', garmentTypeId: '00000000-0000-4000-8000-000000000000' },
        ]),
      ),
    ).rejects.toThrow('Garment type not found');
  });

  it('addGarment with a type auto-links charts and applies defaults', async () => {
    const chart = await seedChart('Hoodie Chart');
    const type = await createGarmentType(hoodieInput({ sizeChartIds: [chart.id] }));
    const created = await createOrder(orderInput([{ name: 'Jersey' }]));

    const garment = await addGarment(created.orderId, {
      name: 'Team Hoodie',
      garmentTypeId: type.id,
    });

    expect(garment.garmentTypeId).toBe(type.id);
    expect(garment.selectedOptions).toEqual({ 'Zip Type': 'pullover', 'Cord Color': 'Black' });

    const links = await db.query.garmentSizeChartLinks.findMany({
      where: eq(schema.garmentSizeChartLinks.garmentId, garment.id),
    });
    expect(links.map((l) => l.sizeChartId)).toEqual([chart.id]);
  });

  it('updateGarment with garmentTypeId null clears the type and its options', async () => {
    const type = await createGarmentType(hoodieInput());
    const created = await createOrder(
      orderInput([{ name: 'Team Hoodie', garmentTypeId: type.id }]),
    );
    const garment = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    });

    await updateGarment(garment!.id, { garmentTypeId: null });

    const after = await db.query.garments.findFirst({ where: eq(schema.garments.id, garment!.id) });
    expect(after!.garmentTypeId).toBeNull();
    expect(after!.selectedOptions).toBeNull();
  });

  it('duplicateOrder copies garmentTypeId and selectedOptions', async () => {
    const type = await createGarmentType(hoodieInput());
    const created = await createOrder(
      orderInput([
        { name: 'Team Hoodie', garmentTypeId: type.id, selectedOptions: { 'Cord Color': 'Red' } },
      ]),
    );

    const dupe = await duplicateOrder(created.orderId);
    const copied = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, dupe.orderId),
    });

    expect(copied!.garmentTypeId).toBe(type.id);
    expect(copied!.selectedOptions).toMatchObject({ 'Cord Color': 'Red' });
  });
});

describe('fabric fields', () => {
  it('persists labeled fabric fields and round-trips them', async () => {
    const created = await createGarmentType(
      createGarmentTypeSchema.parse({
        name: 'Zip Hoodie',
        fabricFields: [
          { label: 'Outer Fabric', options: ['Cotton Fleece', 'Poly Fleece'] },
          { label: 'Hood Lining', options: ['Self-fabric'] },
        ],
      }),
    );

    const fetched = await getGarmentType(created.id);
    expect(fetched.fabricFields).toEqual([
      { label: 'Outer Fabric', options: ['Cotton Fleece', 'Poly Fleece'] },
      { label: 'Hood Lining', options: ['Self-fabric'] },
    ]);
  });

  it('update replaces fabric fields', async () => {
    const created = await createGarmentType(
      createGarmentTypeSchema.parse({
        name: 'Zip Hoodie',
        fabricFields: [{ label: 'Outer Fabric', options: ['Cotton Fleece'] }],
      }),
    );

    const updated = await updateGarmentType(created.id, {
      fabricFields: [{ label: 'Main', options: ['Mesh'] }],
    });
    expect(updated.fabricFields).toEqual([{ label: 'Main', options: ['Mesh'] }]);
  });

  it('update ignores a legacy sizes payload', async () => {
    const created = await createGarmentType(
      createGarmentTypeSchema.parse({ name: 'Zip Hoodie' }),
    );

    const updated = await updateGarmentType(created.id, {
      sizes: [{ sizeRange: 'mens', sizes: ['S'] }],
    });
    expect(updated.sizes).toEqual([]);
  });
});

describe('selected fabrics on garments', () => {
  function orderInput(garments: unknown[]) {
    return createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments,
    });
  }

  it('createOrder persists selectedFabrics and duplicateOrder copies them', async () => {
    const type = await createGarmentType(hoodieInput());
    const created = await createOrder(
      orderInput([
        {
          name: 'Team Hoodie',
          garmentTypeId: type.id,
          selectedFabrics: { 'Outer Fabric': 'Cotton Fleece', 'Hood Lining': 'Self-fabric' },
        },
      ]),
    );

    const garment = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, created.orderId),
    });
    expect(garment!.selectedFabrics).toEqual({
      'Outer Fabric': 'Cotton Fleece',
      'Hood Lining': 'Self-fabric',
    });

    const dupe = await duplicateOrder(created.orderId);
    const copied = await db.query.garments.findFirst({
      where: eq(schema.garments.orderId, dupe.orderId),
    });
    expect(copied!.selectedFabrics).toEqual({
      'Outer Fabric': 'Cotton Fleece',
      'Hood Lining': 'Self-fabric',
    });
  });

  it('addGarment persists selectedFabrics and clearing the type clears them', async () => {
    const type = await createGarmentType(hoodieInput());
    const created = await createOrder(orderInput([{ name: 'Jersey' }]));

    const garment = await addGarment(created.orderId, {
      name: 'Team Hoodie',
      garmentTypeId: type.id,
      selectedFabrics: { 'Outer Fabric': 'Poly Fleece' },
    });
    expect(garment.selectedFabrics).toEqual({ 'Outer Fabric': 'Poly Fleece' });

    await updateGarment(garment.id, { garmentTypeId: null });
    const after = await db.query.garments.findFirst({ where: eq(schema.garments.id, garment.id) });
    expect(after!.selectedFabrics).toBeNull();
  });
});
