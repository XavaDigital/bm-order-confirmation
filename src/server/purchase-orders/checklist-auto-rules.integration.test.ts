/**
 * The checklist rules that answer themselves (David, 2026-08-08).
 *
 * These decide whether a purchase order can be sent, so the two directions both
 * matter: a check must go green the moment the thing it asks about exists, and
 * it must go back to red when that thing is removed. A check that only ever
 * latches on would let a job through after someone deleted the design file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    uploadFile: vi.fn().mockResolvedValue('key'),
    isStorageConfigured: () => true,
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import { createPurchaseOrder, updatePurchaseOrder } from './service';
import { getPoChecklist } from './checklist-service';
import { evaluatePoGarmentReadiness } from './garment-readiness';

afterEach(async () => {
  await resetTestDb(db);
});

let seq = 0;

/** A PO whose single garment is FULLY specified, so every check starts green. */
async function seedReadyPo() {
  seq += 1;
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({ name: `Dynasty ${seq}`, supplierCode: `D${seq}`, email: `d${seq}@example.com` })
    .returning();
  const [chart] = await db
    .insert(schema.sizeCharts)
    .values({ name: `Chart ${seq}`, kind: 'customer' })
    .returning();

  const created = await createOrder(
    createOrderSchema.parse({
      customer: { name: 'Jane Coach', email: 'jane@example.com' },
      garments: [{ name: 'Home Jersey', fabrics: ['Polyester'], sizing: [{ size: 'M' }] }],
    }),
  );
  const garment = (await db.query.garments.findFirst({
    where: eq(schema.garments.orderId, created.orderId),
  }))!;
  await db.insert(schema.garmentSizeChartLinks).values({
    garmentId: garment.id,
    sizeChartId: chart.id,
  });
  await db.insert(schema.mockupImages).values({
    garmentId: garment.id,
    storageKey: `mock/${garment.id}.png`,
  });

  const po = await createPurchaseOrder({
    orderId: created.orderId,
    supplierId: supplier.id,
    garmentIds: [garment.id],
    expectedShipDate: '2026-09-30',
  });
  return { orderId: created.orderId, garmentId: garment.id, po };
}

async function check(poId: string, rule: string) {
  const entries = await getPoChecklist(poId);
  return entries.find((e) => e.autoRule === rule)!;
}

describe('garment specification rules', () => {
  it('are all satisfied for a fully specified garment', async () => {
    const { po } = await seedReadyPo();

    expect((await check(po.id, 'garment_images_all')).satisfied).toBe(true);
    expect((await check(po.id, 'garment_size_charts_all')).satisfied).toBe(true);
    expect((await check(po.id, 'garment_fabrics_all')).satisfied).toBe(true);
    expect((await check(po.id, 'garment_required_options_all')).satisfied).toBe(true);
  });

  it('goes back to outstanding when the only image is removed', async () => {
    const { garmentId, po } = await seedReadyPo();

    await db.delete(schema.mockupImages).where(eq(schema.mockupImages.garmentId, garmentId));

    expect((await check(po.id, 'garment_images_all')).satisfied).toBe(false);
  });

  it('goes back to outstanding when the size chart link is removed', async () => {
    const { garmentId, po } = await seedReadyPo();

    await db
      .delete(schema.garmentSizeChartLinks)
      .where(eq(schema.garmentSizeChartLinks.garmentId, garmentId));

    expect((await check(po.id, 'garment_size_charts_all')).satisfied).toBe(false);
  });

  it('goes back to outstanding when the fabric is cleared', async () => {
    const { garmentId, po } = await seedReadyPo();

    await db
      .update(schema.garments)
      .set({ fabrics: [], selectedFabrics: null })
      .where(eq(schema.garments.id, garmentId));

    expect((await check(po.id, 'garment_fabrics_all')).satisfied).toBe(false);
  });

  // None of the six may be acknowledged past — David's explicit ruling.
  it('cannot be sidestepped', async () => {
    const { po } = await seedReadyPo();
    const entries = await getPoChecklist(po.id);

    const sixKeys = [
      'garment_images_all',
      'garment_size_charts_all',
      'garment_fabrics_all',
      'garment_required_options_all',
      'expected_ship_date_set',
      'customer_deadline_set',
    ];
    for (const key of sixKeys) {
      const entry = entries.find((e) => e.autoRule === key)!;
      expect(entry, key).toBeDefined();
      expect(entry.allowSidestep, key).toBe(false);
    }
  });
});

describe('per-garment detail', () => {
  it('names the garment and everything it is missing', async () => {
    const { garmentId, po } = await seedReadyPo();
    await db.delete(schema.mockupImages).where(eq(schema.mockupImages.garmentId, garmentId));
    await db
      .delete(schema.garmentSizeChartLinks)
      .where(eq(schema.garmentSizeChartLinks.garmentId, garmentId));

    const readiness = await evaluatePoGarmentReadiness(po.id);

    expect(readiness.garments).toHaveLength(1);
    expect(readiness.garments[0].name).toBe('Home Jersey');
    expect(readiness.garments[0].ready).toBe(false);
    expect(readiness.garments[0].issues.map((i) => i.requirement)).toEqual(['image', 'sizeChart']);
  });

  it('marks a fully specified garment ready with no issues', async () => {
    const { po } = await seedReadyPo();

    const readiness = await evaluatePoGarmentReadiness(po.id);

    expect(readiness.garments[0].ready).toBe(true);
    expect(readiness.garments[0].issues).toEqual([]);
  });
});

describe('the two date rules', () => {
  it('is satisfied when the shipping date is set and outstanding when cleared', async () => {
    const { po } = await seedReadyPo();
    expect((await check(po.id, 'expected_ship_date_set')).satisfied).toBe(true);

    await updatePurchaseOrder(po.id, { expectedShipDate: null });

    expect((await check(po.id, 'expected_ship_date_set')).satisfied).toBe(false);
  });

  // The PO's deadline IS the customer deadline, copied from the order at
  // create — the seed order has none, so this starts outstanding.
  it('is outstanding until the customer deadline exists', async () => {
    const { orderId, po } = await seedReadyPo();
    expect((await check(po.id, 'customer_deadline_set')).satisfied).toBe(false);

    await db
      .update(schema.purchaseOrders)
      .set({ deadlineDate: '2026-10-15' })
      .where(eq(schema.purchaseOrders.orderId, orderId));

    expect((await check(po.id, 'customer_deadline_set')).satisfied).toBe(true);
  });
});

describe('the font file rule', () => {
  it('is outstanding until a font file is attached, then satisfied', async () => {
    const { po } = await seedReadyPo();
    expect((await check(po.id, 'font_file_attached')).satisfied).toBe(false);

    await db.insert(schema.poFiles).values({
      poId: po.id,
      category: 'Font file',
      fileName: 'Brand.otf',
      storageKey: `po/${po.id}/Brand.otf`,
      sizeBytes: 1024,
      uploadedByKind: 'staff',
      statusAtUpload: 'draft',
    });

    expect((await check(po.id, 'font_file_attached')).satisfied).toBe(true);
  });

  // "We looked and there are none" is a judgement a person makes, so the check
  // stays tickable by hand for a job with no live text.
  it('is still tickable by hand when no font is needed', async () => {
    const { po } = await seedReadyPo();
    const entry = await check(po.id, 'font_file_attached');

    expect(entry.auto).toBe(false);
    expect(entry.satisfied).toBe(false);
  });
});

/**
 * Short titles with the explanation underneath (David, 2026-08-08). Migration
 * 0052 re-words the seeded checks; the sentence that WAS the title becomes the
 * explanation.
 */
describe('check titles and explanations', () => {
  it('gives every seeded check a short title and an explanation', async () => {
    const { po } = await seedReadyPo();
    const entries = await getPoChecklist(po.id);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      // A title long enough to be a sentence is the thing this replaced.
      expect(entry.label.length, entry.label).toBeLessThanOrEqual(30);
      expect(entry.description, entry.label).toBeTruthy();
    }
  });

  it('re-words the checks by their seeded label, leaving anything renamed alone', async () => {
    const { po } = await seedReadyPo();
    const entries = await getPoChecklist(po.id);
    const byRule = new Map(entries.map((e) => [e.autoRule, e]));

    expect(byRule.get('garment_size_charts_all')?.label).toBe('Size charts');
    expect(byRule.get('garment_size_charts_all')?.description).toMatch(/cut to/i);
    expect(byRule.get('design_file_attached')?.label).toBe('Design file');
  });
});
