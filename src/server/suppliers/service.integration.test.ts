import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db', async () => {
  const { createTestDb } = await import('@/db/test-helpers');
  const schema = await import('@/db/schema');
  const { db } = await createTestDb();
  return { db, schema };
});

import { db } from '@/db';
import { resetTestDb } from '@/db/test-helpers';
import { createSupplierSchema, updateSupplierSchema } from './contract';
import {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  supplierCodeOrFallback,
} from './service';

afterEach(async () => {
  await resetTestDb(db);
});

function supplierInput(overrides: Record<string, unknown> = {}) {
  return createSupplierSchema.parse({
    name: 'Dongguan Apparel Co.',
    supplierCode: 'DG',
    contactPerson: 'Li Wei',
    email: 'sales@dongguan-apparel.example',
    phone: '+86 138 0000 0000',
    website: 'https://dongguan-apparel.example',
    address: { line1: '88 Factory Road', city: 'Dongguan', country: 'China' },
    specialties: ['hoodies', 'sublimation'],
    minimumOrderQuantity: 50,
    leadTimeWeeks: 4,
    notes: 'Preferred partner for fleece.',
    ...overrides,
  });
}

describe('suppliers service', () => {
  it('creates a supplier and reads it back', async () => {
    const created = await createSupplier(supplierInput());

    expect(created.name).toBe('Dongguan Apparel Co.');
    expect(created.supplierCode).toBe('DG');
    expect(created.specialties).toEqual(['hoodies', 'sublimation']);
    expect(created.isActive).toBe(true);

    const fetched = await getSupplier(created.id);
    expect(fetched.address).toEqual({ line1: '88 Factory Road', city: 'Dongguan', country: 'China' });
    expect(fetched.minimumOrderQuantity).toBe(50);
    expect(fetched.leadTimeWeeks).toBe(4);
  });

  it('lowercases codes are uppercased by the contract', () => {
    const parsed = createSupplierSchema.parse({ name: 'X Co', supplierCode: 'dg' });
    expect(parsed.supplierCode).toBe('DG');
  });

  it('listSuppliers filters to active suppliers when asked', async () => {
    await createSupplier(supplierInput({ name: 'Active Supplier', supplierCode: 'AS' }));
    const retired = await createSupplier(
      supplierInput({ name: 'Retired Supplier', supplierCode: 'RS' }),
    );
    await updateSupplier(retired.id, { isActive: false });

    const all = await listSuppliers();
    const active = await listSuppliers({ activeOnly: true });

    expect(all.map((s) => s.name).sort()).toEqual(['Active Supplier', 'Retired Supplier']);
    expect(active.map((s) => s.name)).toEqual(['Active Supplier']);
  });

  it('throws NotFound for an unknown id', async () => {
    await expect(getSupplier('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      'Supplier not found',
    );
    await expect(
      updateSupplier('00000000-0000-4000-8000-000000000000', { name: 'X' }),
    ).rejects.toThrow('Supplier not found');
  });

  it('update patches provided fields, clears nullables with null, and deactivates', async () => {
    const created = await createSupplier(supplierInput());

    const updated = await updateSupplier(
      created.id,
      updateSupplierSchema.parse({
        name: 'Dongguan Apparel (New)',
        contactPerson: null,
        minimumOrderQuantity: null,
        isActive: false,
      }),
    );

    expect(updated.name).toBe('Dongguan Apparel (New)');
    expect(updated.contactPerson).toBeNull();
    expect(updated.minimumOrderQuantity).toBeNull();
    expect(updated.isActive).toBe(false);
    // Untouched fields survive the patch.
    expect(updated.supplierCode).toBe('DG');
    expect(updated.leadTimeWeeks).toBe(4);
  });

  it('rejects a duplicate supplier code with ConflictError on create and update', async () => {
    await createSupplier(supplierInput({ name: 'First', supplierCode: 'DG' }));
    await expect(
      createSupplier(supplierInput({ name: 'Second', supplierCode: 'DG' })),
    ).rejects.toThrow('Supplier code already in use');

    const other = await createSupplier(supplierInput({ name: 'Third', supplierCode: 'TH' }));
    await expect(updateSupplier(other.id, { supplierCode: 'DG' })).rejects.toThrow(
      'Supplier code already in use',
    );
  });

  it('allows multiple suppliers with no code (unique index is partial)', async () => {
    await createSupplier(supplierInput({ name: 'One', supplierCode: undefined }));
    await createSupplier(supplierInput({ name: 'Two', supplierCode: undefined }));
    const all = await listSuppliers();
    expect(all).toHaveLength(2);
    expect(all.every((s) => s.supplierCode === null)).toBe(true);
  });
});

describe('supplierCodeOrFallback', () => {
  it('returns the explicit supplierCode when set', () => {
    expect(supplierCodeOrFallback({ supplierCode: 'DGA', name: 'Dongguan Apparel' })).toBe('DGA');
  });

  it('derives first letters of the first two words', () => {
    expect(supplierCodeOrFallback({ supplierCode: null, name: 'Dongguan Apparel Co.' })).toBe('DA');
  });

  it('uses the first two chars of a single-word name', () => {
    expect(supplierCodeOrFallback({ supplierCode: null, name: 'Fabrico' })).toBe('FA');
  });

  it('uppercases the derived code', () => {
    expect(supplierCodeOrFallback({ supplierCode: null, name: 'best mode' })).toBe('BM');
  });

  it('strips non-alphanumerics before deriving', () => {
    expect(supplierCodeOrFallback({ supplierCode: null, name: '#1 (Sports) Gear' })).toBe('1S');
  });

  it('pads with X when the name yields fewer than two chars', () => {
    expect(supplierCodeOrFallback({ supplierCode: null, name: 'Q' })).toBe('QX');
    expect(supplierCodeOrFallback({ supplierCode: null, name: '!!!' })).toBe('XX');
    expect(supplierCodeOrFallback({ supplierCode: null, name: 'A !!' })).toBe('AX');
  });
});
