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
    uploadFile: vi.fn().mockResolvedValue('mock-storage-key'),
    getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/mock'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import * as schema from '@/db/schema';
import { createOrderSchema } from '@/server/orders/contract';
import { createOrder } from '@/server/orders/service';
import {
  listSizeCharts,
  createSizeChart,
  updateSizeChart,
  deleteSizeChart,
  getSizeChartSignedUrl,
  SizeChartNotFoundError,
} from './service';
import { uploadFile, getSignedUrl, deleteFile } from '@/lib/storage';

afterEach(async () => {
  await resetTestDb(db);
  vi.mocked(uploadFile).mockClear();
  vi.mocked(getSignedUrl).mockClear();
  vi.mocked(deleteFile).mockClear();
  vi.mocked(getSignedUrl).mockResolvedValue('https://signed.example.com/mock');
});

async function seedSizeChart(overrides: Partial<typeof schema.sizeCharts.$inferInsert> = {}) {
  const [chart] = await db
    .insert(schema.sizeCharts)
    .values({ name: 'Adult Unisex', ...overrides })
    .returning();
  return chart;
}

function minimalOrderInput(overrides: Partial<Parameters<typeof createOrderSchema.parse>[0]> = {}) {
  return createOrderSchema.parse({
    customer: { name: 'Jane Coach', email: 'jane@example.com' },
    garments: [{ name: 'Home Jersey' }],
    ...overrides,
  });
}

describe('listSizeCharts', () => {
  it('returns charts ordered by name', async () => {
    await seedSizeChart({ name: 'Zebra Chart' });
    await seedSizeChart({ name: 'Alpha Chart' });

    const charts = await listSizeCharts();

    expect(charts.map((c) => c.name)).toEqual(['Alpha Chart', 'Zebra Chart']);
  });

  it('resolves url via getSignedUrl when storageKey is set', async () => {
    await seedSizeChart({ storageKey: 'size-charts/foo.png' });

    const charts = await listSizeCharts();

    expect(charts[0].url).toBe('https://signed.example.com/mock');
    expect(getSignedUrl).toHaveBeenCalledWith('size-charts/foo.png', expect.any(Number));
  });

  it('returns url: null and does not call getSignedUrl when storageKey is null', async () => {
    await seedSizeChart({ storageKey: null });

    const charts = await listSizeCharts();

    expect(charts[0].url).toBeNull();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns url: null (not throw) when getSignedUrl rejects', async () => {
    await seedSizeChart({ storageKey: 'size-charts/foo.png' });
    vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error('s3 down'));

    const charts = await listSizeCharts();

    expect(charts[0].url).toBeNull();
  });
});

describe('createSizeChart', () => {
  it('calls uploadFile with the constructed key, inserts a row, and returns it with a resolved url', async () => {
    const result = await createSizeChart({
      name: 'Youth Chart',
      description: 'For kids',
      buffer: Buffer.from('hello'),
      mimeType: 'image/png',
      ext: 'png',
    });

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [key, buffer, mime] = vi.mocked(uploadFile).mock.calls[0];
    expect(key).toMatch(/^size-charts\/.+\.png$/);
    expect(buffer.toString()).toBe('hello');
    expect(mime).toBe('image/png');

    expect(result.name).toBe('Youth Chart');
    expect(result.storageKey).toBe(key);
    expect(result.url).toBe('https://signed.example.com/mock');

    const row = await db.query.sizeCharts.findFirst({ where: eq(schema.sizeCharts.id, result.id) });
    expect(row).toBeDefined();
    expect(row!.storageKey).toBe(key);
  });
});

describe('updateSizeChart', () => {
  it('patches only the provided fields', async () => {
    const chart = await seedSizeChart({ name: 'Original Name', description: 'Original desc' });

    const updated = await updateSizeChart(chart.id, { name: 'New Name' });

    expect(updated.name).toBe('New Name');
    expect(updated.description).toBe('Original desc');
  });

  it('throws SizeChartNotFoundError for an unknown id', async () => {
    await expect(
      updateSizeChart('00000000-0000-0000-0000-000000000000', { name: 'X' }),
    ).rejects.toThrow(SizeChartNotFoundError);
  });
});

describe('deleteSizeChart', () => {
  it('returns linkedGarmentCount: 0 when no garments are linked', async () => {
    const chart = await seedSizeChart();

    const result = await deleteSizeChart(chart.id);

    expect(result.linkedGarmentCount).toBe(0);
  });

  it('returns linkedGarmentCount: 1 when one garment is linked', async () => {
    const chart = await seedSizeChart({ storageKey: 'size-charts/one.png' });
    await createOrder(minimalOrderInput({ garments: [{ name: 'Jersey', sizeChartIds: [chart.id] }] }));

    const result = await deleteSizeChart(chart.id);

    expect(result.linkedGarmentCount).toBe(1);
  });

  it('returns linkedGarmentCount: 2+ when multiple garments are linked', async () => {
    const chart = await seedSizeChart();
    await createOrder(
      minimalOrderInput({
        garments: [
          { name: 'Jersey 1', sizeChartIds: [chart.id] },
          { name: 'Jersey 2', sizeChartIds: [chart.id] },
        ],
      }),
    );

    const result = await deleteSizeChart(chart.id);

    expect(result.linkedGarmentCount).toBe(2);
  });

  it('deletes the chart row and cascades garmentSizeChartLinks, calls deleteFile, throws for unknown id', async () => {
    const chart = await seedSizeChart({ storageKey: 'size-charts/cascade.png' });
    const created = await createOrder(
      minimalOrderInput({ garments: [{ name: 'Jersey', sizeChartIds: [chart.id] }] }),
    );

    await deleteSizeChart(chart.id);

    const row = await db.query.sizeCharts.findFirst({ where: eq(schema.sizeCharts.id, chart.id) });
    expect(row).toBeUndefined();

    const links = await db
      .select()
      .from(schema.garmentSizeChartLinks)
      .where(eq(schema.garmentSizeChartLinks.sizeChartId, chart.id));
    expect(links).toHaveLength(0);

    // sanity: the garment/order itself is untouched
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, created.orderId) });
    expect(order).toBeDefined();

    await vi.waitFor(() => expect(deleteFile).toHaveBeenCalledWith('size-charts/cascade.png'));

    await expect(deleteSizeChart('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      SizeChartNotFoundError,
    );
  });
});

describe('getSizeChartSignedUrl', () => {
  it('passes through the ttlSeconds param to getSignedUrl', async () => {
    await getSizeChartSignedUrl('size-charts/foo.png', 999);

    expect(getSignedUrl).toHaveBeenCalledWith('size-charts/foo.png', 999);
  });

  it('returns null (not throw) when getSignedUrl rejects', async () => {
    vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error('s3 down'));

    const url = await getSizeChartSignedUrl('size-charts/foo.png');

    expect(url).toBeNull();
  });
});
