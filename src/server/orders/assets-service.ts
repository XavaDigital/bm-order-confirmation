/**
 * Order assets — design and font file links on an order.
 *
 * Lives beside orders/service.ts rather than inside it: assets are their own
 * table with their own CRUD, and service.ts is already the largest module in the
 * app. Audit rows go on the ORDER aggregate so they land in the order timeline.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orderAssets, garments, orders } from '@/db/schema';
import { pickDefined } from '@/lib/patch';
import { recordAuditEvent } from '@/server/events/outbox';
import { ConflictError, NotFoundError } from './service';
import type { CreateOrderAssetInput, UpdateOrderAssetInput } from './assets-contract';

type ActorMeta = { actorEmail?: string | null };

async function loadAssetOrThrow(id: string) {
  const asset = await db.query.orderAssets.findFirst({ where: eq(orderAssets.id, id) });
  if (!asset) throw new NotFoundError('Asset');
  return asset;
}

/** A tagged garment must belong to the same order — otherwise the tag would leak
 *  another order's garment name onto this order's purchase orders. */
async function assertGarmentBelongsToOrder(orderId: string, garmentId: string) {
  const garment = await db.query.garments.findFirst({
    where: and(eq(garments.id, garmentId), eq(garments.orderId, orderId)),
    columns: { id: true },
  });
  if (!garment) throw new ConflictError('That garment does not belong to this order');
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
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true },
  });
  if (!order) throw new NotFoundError('Order');
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
  id: string,
  patch: UpdateOrderAssetInput,
  meta?: ActorMeta,
) {
  const existing = await loadAssetOrThrow(id);
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

export async function deleteOrderAsset(id: string, meta?: ActorMeta) {
  const existing = await loadAssetOrThrow(id);

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
