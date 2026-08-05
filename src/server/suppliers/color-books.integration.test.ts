/**
 * Supplier colour books (David, 2026-08-05): newest first, index 0 IS the
 * default for new POs — no default flag to keep in sync. Books are only ever
 * added, never deleted (old POs and reprints reference them).
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
import { createColorBook, createSupplier, listColorBooks } from './service';

afterEach(async () => {
  await resetTestDb(db);
});

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function seedSupplier(name = 'Dynasty', code = 'DY') {
  return createSupplier({ name, supplierCode: code, specialties: [], isActive: true });
}

/** Force distinct createdAt so newest-first ordering is deterministic. */
async function backdate(bookId: string, daysAgo: number) {
  await db
    .update(schema.supplierColorBooks)
    .set({ createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) })
    .where(eq(schema.supplierColorBooks.id, bookId));
}

describe('createColorBook', () => {
  it('creates a book, trims the name, and stamps the creator', async () => {
    const supplier = await seedSupplier();

    const book = await createColorBook(supplier.id, '  Pantone 2026  ', {
      actorStaffUserId: null,
    });

    expect(book.supplierId).toBe(supplier.id);
    expect(book.name).toBe('Pantone 2026');
    expect(book.createdBy).toBeNull();
  });

  it('rejects a duplicate name for the same supplier with a ConflictError', async () => {
    const supplier = await seedSupplier();
    await createColorBook(supplier.id, 'Pantone 2026');

    await expect(createColorBook(supplier.id, 'Pantone 2026')).rejects.toThrow(
      'This supplier already has a colour book with that name',
    );
  });

  it('allows the same name on a different supplier', async () => {
    const a = await seedSupplier('Dynasty', 'DY');
    const b = await seedSupplier('Goal Sports', 'GOAL');
    await createColorBook(a.id, 'Pantone 2026');

    const book = await createColorBook(b.id, 'Pantone 2026');
    expect(book.supplierId).toBe(b.id);
  });

  it('404s an unknown supplier', async () => {
    await expect(createColorBook(MISSING_ID, 'Pantone 2026')).rejects.toThrow(
      'Supplier not found',
    );
  });
});

describe('listColorBooks', () => {
  it('lists newest first — the default book is always index 0', async () => {
    const supplier = await seedSupplier();
    const oldest = await createColorBook(supplier.id, '2024 Book');
    const middle = await createColorBook(supplier.id, '2025 Book');
    await backdate(oldest.id, 2);
    await backdate(middle.id, 1);
    const newest = await createColorBook(supplier.id, '2026 Book');

    const books = await listColorBooks(supplier.id);

    expect(books.map((b) => b.name)).toEqual(['2026 Book', '2025 Book', '2024 Book']);
    expect(books[0].id).toBe(newest.id);
  });

  it('scopes to the supplier and answers empty for a supplier without books', async () => {
    const a = await seedSupplier('Dynasty', 'DY');
    const b = await seedSupplier('Goal Sports', 'GOAL');
    await createColorBook(a.id, 'Pantone 2026');

    expect(await listColorBooks(b.id)).toEqual([]);
  });

  it('404s an unknown supplier', async () => {
    await expect(listColorBooks(MISSING_ID)).rejects.toThrow('Supplier not found');
  });
});
