/**
 * The picture on a kanban card (David, 2026-08-09: "mainly for easier internal
 * reference … it'll just be the first garment in the list").
 *
 * Not a new field anyone has to set: it is DERIVED — the first image of the
 * first garment. A "featured image" someone has to choose is a field that goes
 * stale the moment a garment is reordered, and this exists so a person can
 * recognise a job at a glance, not so it can be curated.
 *
 * The two boards resolve it from different places, deliberately:
 *  - an ORDER takes its own first garment;
 *  - a PURCHASE ORDER takes the first garment IN ITS OWN SCOPE, read from the
 *    revision snapshot. A PO covers a subset of the order's garments, and
 *    showing a garment the factory was never sent would be worse than showing
 *    nothing.
 *
 * Thumbnails where they exist, because a board can show fifty of these at once.
 * Signing failures degrade to no picture — a card with no image is fine, a
 * board that fails to load is not.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { garments, mockupImages, purchaseOrderRevisions, purchaseOrders } from '@/db/schema';
import { getSignedUrl } from '@/lib/storage';

/** How long a board's picture links stay good. Longer than anyone stares at it. */
const TTL_SECONDS = 60 * 30;

async function sign(storageKey: string | null | undefined): Promise<string | null> {
  if (!storageKey) return null;
  return getSignedUrl(storageKey, TTL_SECONDS).catch(() => null);
}

/** Sign a key per id, dropping the ones that fail or have nothing to sign. */
async function signAll(keys: Map<string, string>): Promise<Map<string, string>> {
  const entries = await Promise.all(
    [...keys].map(async ([id, key]) => [id, await sign(key)] as const),
  );
  const out = new Map<string, string>();
  for (const [id, url] of entries) if (url) out.set(id, url);
  return out;
}

/** orderId → signed thumbnail of its first garment's first image. */
export async function orderFeaturedImages(orderIds: string[]): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();

  // One query, ordered the way the two lists are displayed; the first row per
  // order wins. Includes internal-only images: this is a staff board, and the
  // point is recognising the job.
  const rows = await db
    .select({
      orderId: garments.orderId,
      storageKey: mockupImages.storageKey,
      thumbnailStorageKey: mockupImages.thumbnailStorageKey,
    })
    .from(garments)
    .innerJoin(mockupImages, eq(mockupImages.garmentId, garments.id))
    .where(inArray(garments.orderId, orderIds))
    .orderBy(
      asc(garments.sortOrder),
      asc(garments.createdAt),
      asc(mockupImages.sortOrder),
      asc(mockupImages.createdAt),
    );

  const firstPerOrder = new Map<string, string>();
  for (const row of rows) {
    if (firstPerOrder.has(row.orderId)) continue;
    firstPerOrder.set(row.orderId, row.thumbnailStorageKey ?? row.storageKey);
  }
  return signAll(firstPerOrder);
}

/** poId → signed thumbnail of the first garment on the PO's current revision. */
export async function poFeaturedImages(poIds: string[]): Promise<Map<string, string>> {
  if (poIds.length === 0) return new Map();

  // Joined on the PO's own pointer to its latest revision, which is unique on
  // (poId, revisionNumber) — exact, and one row per purchase order.
  const rows = await db
    .select({ poId: purchaseOrders.id, snapshot: purchaseOrderRevisions.snapshot })
    .from(purchaseOrders)
    .innerJoin(
      purchaseOrderRevisions,
      and(
        eq(purchaseOrderRevisions.poId, purchaseOrders.id),
        eq(purchaseOrderRevisions.revisionNumber, purchaseOrders.currentRevisionNumber),
      ),
    )
    .where(inArray(purchaseOrders.id, poIds));

  const firstPerPo = new Map<string, string>();
  for (const row of rows) {
    // The first garment that HAS an image — a first garment with none should
    // not blank the card when a later one would do.
    for (const garment of row.snapshot.garments ?? []) {
      const image = garment.images?.[0];
      if (image) {
        firstPerPo.set(row.poId, image.thumbnailStorageKey ?? image.storageKey);
        break;
      }
    }
  }
  return signAll(firstPerPo);
}
