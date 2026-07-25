/**
 * Garment-type preset catalog service (admin-managed reference data).
 *
 * Types are deactivate-never-delete (Sales Hub dictionary convention):
 * garments on old orders keep pointing at retired types, so there is no
 * delete here — only an isActive toggle via update.
 */
import { eq, asc } from 'drizzle-orm';
import { db } from '@/db';
import { garmentTypes, garmentTypeSizeChartLinks } from '@/db/schema';
import { NotFoundError } from '@/server/orders/service';
import type { CreateGarmentTypeInput, UpdateGarmentTypeInput } from './contract';

function withSizeChartIds<T extends { sizeChartLinks: { sizeChartId: string }[] }>(row: T) {
  const { sizeChartLinks, ...rest } = row;
  return { ...rest, sizeChartIds: sizeChartLinks.map((l) => l.sizeChartId) };
}

export async function listGarmentTypes(opts?: { activeOnly?: boolean }) {
  const rows = await db.query.garmentTypes.findMany({
    where: opts?.activeOnly ? eq(garmentTypes.isActive, true) : undefined,
    orderBy: [asc(garmentTypes.sortOrder), asc(garmentTypes.name)],
    with: { sizeChartLinks: { columns: { sizeChartId: true } } },
  });
  return rows.map(withSizeChartIds);
}

export async function getGarmentType(id: string) {
  const row = await db.query.garmentTypes.findFirst({
    where: eq(garmentTypes.id, id),
    with: { sizeChartLinks: { columns: { sizeChartId: true } } },
  });
  if (!row) throw new NotFoundError('Garment type');
  return withSizeChartIds(row);
}

export async function createGarmentType(input: CreateGarmentTypeInput) {
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(garmentTypes)
      .values({
        name: input.name,
        category: input.category ?? null,
        // input.fabricOptions deliberately NOT persisted — legacy column is
        // read-only (effectiveFabricFields adapts old rows); new rows use fabricFields
        fabricFields: input.fabricFields,
        orderOptions: input.orderOptions,
        // input.sizes deliberately NOT persisted — sizes live on size charts now
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      })
      .returning();

    if (input.sizeChartIds.length > 0) {
      await tx.insert(garmentTypeSizeChartLinks).values(
        input.sizeChartIds.map((sizeChartId) => ({ garmentTypeId: row.id, sizeChartId })),
      );
    }
    return row;
  });

  return getGarmentType(created.id);
}

export async function updateGarmentType(id: string, patch: UpdateGarmentTypeInput) {
  const existing = await db.query.garmentTypes.findFirst({ where: eq(garmentTypes.id, id) });
  if (!existing) throw new NotFoundError('Garment type');

  await db.transaction(async (tx) => {
    await tx
      .update(garmentTypes)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.category !== undefined && { category: patch.category ?? null }),
        // patch.fabricOptions deliberately ignored — legacy read-only column
        ...(patch.fabricFields !== undefined && { fabricFields: patch.fabricFields }),
        ...(patch.orderOptions !== undefined && { orderOptions: patch.orderOptions }),
        // patch.sizes deliberately ignored — sizes live on size charts now
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
        updatedAt: new Date(),
      })
      .where(eq(garmentTypes.id, id));

    if (patch.sizeChartIds !== undefined) {
      await tx
        .delete(garmentTypeSizeChartLinks)
        .where(eq(garmentTypeSizeChartLinks.garmentTypeId, id));
      if (patch.sizeChartIds.length > 0) {
        await tx.insert(garmentTypeSizeChartLinks).values(
          patch.sizeChartIds.map((sizeChartId) => ({ garmentTypeId: id, sizeChartId })),
        );
      }
    }
  });

  return getGarmentType(id);
}
