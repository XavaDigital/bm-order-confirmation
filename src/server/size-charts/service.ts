import { randomBytes } from 'node:crypto';
import { eq, count } from 'drizzle-orm';
import { db } from '@/db';
import { sizeCharts, garmentSizeChartLinks } from '@/db/schema';
import { uploadFile, getSignedUrl, deleteFile, sizeChartKey } from '@/lib/storage';
import { logger } from '@/lib/logger';

export class SizeChartNotFoundError extends Error {
  constructor() {
    super('Size chart not found');
    this.name = 'SizeChartNotFoundError';
  }
}

const SIGNED_URL_TTL = 4 * 3600; // 4 hours for admin; 1 hour for customer (passed in)

async function withUrl(chart: typeof sizeCharts.$inferSelect, ttl = SIGNED_URL_TTL) {
  let url: string | null = null;
  if (chart.storageKey) {
    url = await getSignedUrl(chart.storageKey, ttl).catch(() => null);
  }
  return { ...chart, url };
}

// ---------------------------------------------------------------------------

export async function listSizeCharts() {
  const charts = await db.query.sizeCharts.findMany({
    orderBy: (sc, { asc }) => [asc(sc.name)],
  });
  return Promise.all(charts.map((c) => withUrl(c)));
}

export async function createSizeChart(params: {
  name: string;
  description?: string | null;
  buffer: Buffer;
  mimeType: string;
  ext: string;
}) {
  const filename = `${randomBytes(8).toString('hex')}.${params.ext}`;
  const key = sizeChartKey(filename);

  await uploadFile(key, params.buffer, params.mimeType);

  const [chart] = await db
    .insert(sizeCharts)
    .values({ name: params.name, description: params.description ?? null, storageKey: key })
    .returning();

  return withUrl(chart);
}

export async function updateSizeChart(
  id: string,
  patch: { name?: string; description?: string | null },
) {
  const existing = await db.query.sizeCharts.findFirst({ where: eq(sizeCharts.id, id) });
  if (!existing) throw new SizeChartNotFoundError();

  const [chart] = await db
    .update(sizeCharts)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      updatedAt: new Date(),
    })
    .where(eq(sizeCharts.id, id))
    .returning();

  return withUrl(chart);
}

export async function deleteSizeChart(id: string): Promise<{ linkedGarmentCount: number }> {
  const chart = await db.query.sizeCharts.findFirst({ where: eq(sizeCharts.id, id) });
  if (!chart) throw new SizeChartNotFoundError();

  const [{ total }] = await db
    .select({ total: count() })
    .from(garmentSizeChartLinks)
    .where(eq(garmentSizeChartLinks.sizeChartId, id));

  await db.delete(sizeCharts).where(eq(sizeCharts.id, id));

  if (chart.storageKey) {
    deleteFile(chart.storageKey).catch((err) =>
      logger.warn('[size-charts] storage delete failed', chart.storageKey, err),
    );
  }

  return { linkedGarmentCount: Number(total) };
}

/** Generate short-TTL signed URLs for customer-page render (1 hour). */
export async function getSizeChartSignedUrl(storageKey: string, ttlSeconds = 3600) {
  return getSignedUrl(storageKey, ttlSeconds).catch(() => null);
}
