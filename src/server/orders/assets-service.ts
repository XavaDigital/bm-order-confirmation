/**
 * Order assets — design and font file links on an order.
 *
 * Lives beside orders/service.ts rather than inside it: assets are their own
 * table with their own CRUD, and service.ts is already the largest module in the
 * app. Audit rows go on the ORDER aggregate so they land in the order timeline.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orderAssets } from '@/db/schema';
import { pickDefined } from '@/lib/patch';
import { recordAuditEvent } from '@/server/events/outbox';
import { NotFoundError } from './service';
import { assertGarmentBelongsToOrder, assertOrderExists } from './guards';
import type { CreateOrderAssetInput, UpdateOrderAssetInput } from './assets-contract';

type ActorMeta = { actorEmail?: string | null };

/**
 * Load an asset and confirm it really is on that order, so an asset id from a
 * different order is a 404 rather than a silent cross-order write.
 */
async function loadAssetOrThrow(orderId: string, id: string) {
  const asset = await db.query.orderAssets.findFirst({ where: eq(orderAssets.id, id) });
  if (!asset || asset.orderId !== orderId) throw new NotFoundError('Asset');
  return asset;
}

export async function listOrderAssets(orderId: string) {
  return db.query.orderAssets.findMany({
    where: eq(orderAssets.orderId, orderId),
    orderBy: [asc(orderAssets.sortOrder), asc(orderAssets.createdAt)],
    with: { garment: { columns: { id: true, name: true } } },
  });
}

export async function createOrderAsset(
  orderId: string,
  input: CreateOrderAssetInput,
  meta?: ActorMeta & { actorStaffUserId?: string | null },
) {
  await assertOrderExists(orderId);
  if (input.garmentId) await assertGarmentBelongsToOrder(orderId, input.garmentId);

  const asset = await db.transaction(async (tx) => {
    const [{ maxSort }] = await tx
      .select({ maxSort: sql<number>`coalesce(max(${orderAssets.sortOrder}), -1)` })
      .from(orderAssets)
      .where(eq(orderAssets.orderId, orderId));

    const [row] = await tx
      .insert(orderAssets)
      .values({
        orderId,
        garmentId: input.garmentId ?? null,
        kind: input.kind,
        name: input.name,
        url: input.url,
        notes: input.notes ?? null,
        includeOnPo: input.includeOnPo,
        sortOrder: input.sortOrder ?? Number(maxSort) + 1,
        createdBy: meta?.actorStaffUserId ?? null,
      })
      .returning();

    await recordAuditEvent(
      {
        aggregateId: orderId,
        eventType: 'asset.added',
        payload: { assetId: row.id, kind: row.kind, name: row.name },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );

    return row;
  });

  return asset;
}

export async function updateOrderAsset(
  orderId: string,
  id: string,
  patch: UpdateOrderAssetInput,
  meta?: ActorMeta,
) {
  const existing = await loadAssetOrThrow(orderId, id);
  if (patch.garmentId) await assertGarmentBelongsToOrder(existing.orderId, patch.garmentId);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(orderAssets)
      .set({ ...pickDefined(patch), updatedAt: new Date() })
      .where(eq(orderAssets.id, id))
      .returning();

    await recordAuditEvent(
      {
        aggregateId: existing.orderId,
        eventType: 'asset.updated',
        payload: { assetId: id, fields: Object.keys(patch) },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );

    return row;
  });

  return updated;
}

export async function deleteOrderAsset(orderId: string, id: string, meta?: ActorMeta) {
  const existing = await loadAssetOrThrow(orderId, id);

  await db.transaction(async (tx) => {
    await tx.delete(orderAssets).where(eq(orderAssets.id, id));
    await recordAuditEvent(
      {
        aggregateId: existing.orderId,
        eventType: 'asset.removed',
        payload: { assetId: id, name: existing.name },
        actorEmail: meta?.actorEmail ?? null,
      },
      tx,
    );
  });
}

/**
 * The factory-facing assets for a PO snapshot: only those flagged includeOnPo,
 * with the garment name denormalized so a regenerated document doesn't depend on
 * the garment still existing.
 */
export async function loadPoAssets(orderId: string) {
  const rows = await db.query.orderAssets.findMany({
    where: and(eq(orderAssets.orderId, orderId), eq(orderAssets.includeOnPo, true)),
    orderBy: [asc(orderAssets.sortOrder), asc(orderAssets.createdAt)],
    with: { garment: { columns: { name: true } } },
  });

  return rows.map((row) => ({
    kind: row.kind,
    name: row.name,
    url: row.url,
    notes: row.notes ?? null,
    garmentName: row.garment?.name ?? null,
  }));
}
