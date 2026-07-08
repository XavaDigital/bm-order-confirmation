import { describe, it, expect } from 'vitest';
import {
  updateOrderSchema,
  addGarmentSchema,
  updateGarmentSchema,
  upsertSizingSchema,
} from './admin-contract';

describe('updateOrderSchema', () => {
  it('accepts an empty object since every field is optional', () => {
    expect(updateOrderSchema.parse({})).toEqual({});
  });

  it('rejects a non-positive orderValueAmount but allows explicit null to clear it', () => {
    expect(() => updateOrderSchema.parse({ orderValueAmount: 0 })).toThrow();
    expect(() => updateOrderSchema.parse({ orderValueAmount: -5 })).toThrow();
    expect(updateOrderSchema.parse({ orderValueAmount: null }).orderValueAmount).toBeNull();
    expect(updateOrderSchema.parse({ orderValueAmount: 10 }).orderValueAmount).toBe(10);
  });

  it('rejects "confirmed" as a settable status (admins cannot force-confirm via this endpoint)', () => {
    expect(() => updateOrderSchema.parse({ status: 'confirmed' })).toThrow();
  });

  it('accepts the other status values', () => {
    for (const status of ['draft', 'sent', 'viewed', 'changes_requested']) {
      expect(updateOrderSchema.parse({ status }).status).toBe(status);
    }
  });

  it('rejects an invalid status value', () => {
    expect(() => updateOrderSchema.parse({ status: 'bogus' })).toThrow();
  });

  it('allows nullable fields to be explicitly cleared', () => {
    const result = updateOrderSchema.parse({
      customerContact: null,
      clubName: null,
      invoiceUrl: null,
      expectedShipDate: null,
      deadlineDate: null,
      generalNotes: null,
      internalNotes: null,
      shippingAddress: null,
    });
    expect(result.customerContact).toBeNull();
    expect(result.clubName).toBeNull();
    expect(result.internalNotes).toBeNull();
  });

  it('accepts an internalNotes string, independent of generalNotes', () => {
    const result = updateOrderSchema.parse({
      generalNotes: 'Shown to customer',
      internalNotes: 'Discount approved by manager',
    });
    expect(result.generalNotes).toBe('Shown to customer');
    expect(result.internalNotes).toBe('Discount approved by manager');
  });
});

describe('addGarmentSchema', () => {
  it('requires a non-empty name', () => {
    expect(() => addGarmentSchema.parse({ name: '' })).toThrow();
    expect(addGarmentSchema.parse({ name: 'Jersey' }).name).toBe('Jersey');
  });

  it('allows fabrics/notes/sortOrder to be omitted, and notes to be explicitly null', () => {
    expect(addGarmentSchema.parse({ name: 'Jersey' })).toEqual({ name: 'Jersey' });
    expect(addGarmentSchema.parse({ name: 'Jersey', notes: null }).notes).toBeNull();
  });
});

describe('updateGarmentSchema', () => {
  it('makes every field optional, including sizeChartIds', () => {
    expect(updateGarmentSchema.parse({})).toEqual({});
  });

  it('rejects a non-UUID entry in sizeChartIds', () => {
    expect(() => updateGarmentSchema.parse({ sizeChartIds: ['not-a-uuid'] })).toThrow();
  });

  it('accepts a valid UUID in sizeChartIds', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(updateGarmentSchema.parse({ sizeChartIds: [id] }).sizeChartIds).toEqual([id]);
  });
});

describe('upsertSizingSchema', () => {
  it('accepts an empty array (clears all sizing rows)', () => {
    expect(upsertSizingSchema.parse([])).toEqual([]);
  });

  it('accepts a row where every field is explicitly null', () => {
    const row = {
      size: null,
      playerName: null,
      playerNumber: null,
      notes: null,
    };
    expect(upsertSizingSchema.parse([row])).toEqual([row]);
  });
});
