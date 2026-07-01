import { describe, it, expect } from 'vitest';
import { createOrderSchema, garmentSchema, sizingRowSchema } from './contract';

const minimalGarment = { name: 'Home Jersey' };
const minimalPayload = {
  customer: { name: 'Jane Coach', email: 'jane@example.com' },
  garments: [minimalGarment],
};

describe('createOrderSchema', () => {
  it('parses a minimal valid payload and applies defaults', () => {
    const result = createOrderSchema.parse(minimalPayload);
    expect(result.source).toBe('internal_admin');
    expect(result.requireAccessCode).toBe(false);
    expect(result.garments[0].fabrics).toEqual([]);
    expect(result.garments[0].sizing).toEqual([]);
    expect(result.garments[0].sizeChartIds).toEqual([]);
    expect(result.garments[0].mockupStorageKeys).toEqual([]);
  });

  it('defaults shipping.mode to "prefilled" when shipping is provided without a mode', () => {
    const result = createOrderSchema.parse({
      ...minimalPayload,
      shipping: {},
    });
    expect(result.shipping?.mode).toBe('prefilled');
  });

  it('rejects a malformed customer email', () => {
    expect(() =>
      createOrderSchema.parse({
        ...minimalPayload,
        customer: { name: 'Jane', email: 'not-an-email' },
      }),
    ).toThrow();
  });

  it('rejects an empty customer name', () => {
    expect(() =>
      createOrderSchema.parse({
        ...minimalPayload,
        customer: { name: '', email: 'jane@example.com' },
      }),
    ).toThrow();
  });

  it('rejects an empty garments array', () => {
    expect(() => createOrderSchema.parse({ ...minimalPayload, garments: [] })).toThrow();
  });

  it('rejects a garment with an empty name', () => {
    expect(() =>
      createOrderSchema.parse({ ...minimalPayload, garments: [{ name: '' }] }),
    ).toThrow();
  });

  it('accepts orderValue with a zero amount and defaults currency to NZD', () => {
    const result = createOrderSchema.parse({
      ...minimalPayload,
      orderValue: { amount: 0, currency: 'NZD' },
    });
    expect(result.orderValue?.amount).toBe(0);

    const withoutCurrency = createOrderSchema.parse({
      ...minimalPayload,
      orderValue: { amount: 10 },
    });
    expect(withoutCurrency.orderValue?.currency).toBe('NZD');
  });

  it('rejects a negative orderValue amount', () => {
    expect(() =>
      createOrderSchema.parse({ ...minimalPayload, orderValue: { amount: -1 } }),
    ).toThrow();
  });

  it('rejects a currency that is not exactly 3 characters', () => {
    expect(() =>
      createOrderSchema.parse({
        ...minimalPayload,
        orderValue: { amount: 10, currency: 'NZ' },
      }),
    ).toThrow();
  });

  it('rejects a non-URL invoiceUrl but accepts a valid one', () => {
    expect(() =>
      createOrderSchema.parse({ ...minimalPayload, invoiceUrl: 'not-a-url' }),
    ).toThrow();

    const result = createOrderSchema.parse({
      ...minimalPayload,
      invoiceUrl: 'https://example.com/invoice.pdf',
    });
    expect(result.invoiceUrl).toBe('https://example.com/invoice.pdf');
  });

  it('rejects a non-UUID sizeChartIds entry', () => {
    expect(() =>
      createOrderSchema.parse({
        ...minimalPayload,
        garments: [{ name: 'Jersey', sizeChartIds: ['not-a-uuid'] }],
      }),
    ).toThrow();
  });

  it('accepts a valid UUID in sizeChartIds', () => {
    const result = createOrderSchema.parse({
      ...minimalPayload,
      garments: [
        { name: 'Jersey', sizeChartIds: ['123e4567-e89b-12d3-a456-426614174000'] },
      ],
    });
    expect(result.garments[0].sizeChartIds).toEqual(['123e4567-e89b-12d3-a456-426614174000']);
  });

  it('parses a full multi-garment kitchen-sink payload', () => {
    const result = createOrderSchema.parse({
      source: 'platform',
      externalRef: 'ext-123',
      customer: {
        name: 'Jane Coach',
        email: 'jane@example.com',
        contact: '021 555 1234',
        clubName: 'Beast United',
      },
      orderValue: { amount: 1234.5, currency: 'NZD' },
      invoiceUrl: 'https://example.com/invoice.pdf',
      expectedShipDate: '2026-08-01',
      deadlineDate: '2026-07-25',
      generalNotes: 'Rush order',
      shipping: { mode: 'customer_entered', address: { line1: '1 Beast St' } },
      garments: [
        {
          name: 'Home Jersey',
          fabrics: ['polyester'],
          notes: 'V-neck',
          sizing: [{ size: 'M', playerName: 'A. Smith', playerNumber: '7' }],
          sizeChartIds: ['123e4567-e89b-12d3-a456-426614174000'],
          mockupStorageKeys: ['mockups/abc.png'],
        },
        { name: 'Away Jersey' },
      ],
      requireAccessCode: true,
    });

    expect(result.garments).toHaveLength(2);
    expect(result.source).toBe('platform');
    expect(result.requireAccessCode).toBe(true);
  });
});

describe('garmentSchema', () => {
  it('requires a non-empty name', () => {
    expect(() => garmentSchema.parse({ name: '' })).toThrow();
    expect(garmentSchema.parse({ name: 'Jersey' }).name).toBe('Jersey');
  });
});

describe('sizingRowSchema', () => {
  it('allows all fields to be omitted', () => {
    expect(sizingRowSchema.parse({})).toEqual({});
  });
});
