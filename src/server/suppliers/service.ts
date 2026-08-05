/**
 * Supplier directory service (admin-managed reference data).
 *
 * Suppliers are deactivate-never-delete (garment-types convention): purchase
 * orders on old orders keep pointing at retired suppliers, so there is no
 * delete here — only an isActive toggle via update.
 */
import { eq, asc } from 'drizzle-orm';
import { db } from '@/db';
import { suppliers } from '@/db/schema';
import { NotFoundError, ConflictError } from '@/server/orders/service';
import { isUniqueViolation } from '@/lib/db-errors';
import { pickDefined } from '@/lib/patch';
import type { CreateSupplierInput, UpdateSupplierInput } from './contract';

export type Supplier = typeof suppliers.$inferSelect;

/**
 * The code used in PO numbers: the explicit `supplierCode` when set, else a
 * 2-char fallback derived from the name — first letters of the first two
 * words (single word → its first two chars), non-alphanumerics stripped,
 * uppercased, padded with 'X' to two chars.
 */
export function supplierCodeOrFallback(supplier: {
  supplierCode?: string | null;
  name: string;
}): string {
  if (supplier.supplierCode) return supplier.supplierCode;

  const words = supplier.name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 0);

  const raw =
    words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2);

  return (raw.toUpperCase() + 'XX').slice(0, 2);
}

function rethrowCodeConflict(err: unknown): never {
  if (isUniqueViolation(err, 'suppliers_code_uq')) {
    throw new ConflictError('Supplier code already in use');
  }
  throw err;
}

export async function listSuppliers(opts?: { activeOnly?: boolean }) {
  return db.query.suppliers.findMany({
    where: opts?.activeOnly ? eq(suppliers.isActive, true) : undefined,
    orderBy: [asc(suppliers.name)],
  });
}

export async function getSupplier(id: string) {
  const row = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) });
  if (!row) throw new NotFoundError('Supplier');
  return row;
}

export async function createSupplier(input: CreateSupplierInput) {
  try {
    const [row] = await db
      .insert(suppliers)
      .values({
        name: input.name,
        supplierCode: input.supplierCode ?? null,
        portalPassword: input.portalPassword ?? null,
        contactPerson: input.contactPerson ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
        address: input.address ?? null,
        specialties: input.specialties,
        minimumOrderQuantity: input.minimumOrderQuantity ?? null,
        leadTimeWeeks: input.leadTimeWeeks ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive,
      })
      .returning();
    return row;
  } catch (err) {
    rethrowCodeConflict(err);
  }
}

export async function updateSupplier(id: string, patch: UpdateSupplierInput) {
  const existing = await db.query.suppliers.findFirst({ where: eq(suppliers.id, id) });
  if (!existing) throw new NotFoundError('Supplier');

  try {
    const [row] = await db
      .update(suppliers)
      .set({ ...pickDefined(patch), updatedAt: new Date() })
      .where(eq(suppliers.id, id))
      .returning();
    return row;
  } catch (err) {
    rethrowCodeConflict(err);
  }
}
