import { describe, expect, it } from 'vitest';
import {
  SHIPMENT_STATUSES,
  canTransitionShipment,
  createShipmentSchema,
  updateShipmentSchema,
  type ShipmentStatus,
} from './contract';

describe('canTransitionShipment', () => {
  // The full 6x6 matrix, spelled out so any change to the machine is a
  // deliberate edit here — true = legal.
  const MATRIX: Record<ShipmentStatus, Record<ShipmentStatus, boolean>> = {
    pending: {
      pending: false,
      in_transit: true,
      delivered: false,
      delayed: true,
      exception: true,
      cancelled: true,
    },
    in_transit: {
      pending: false,
      in_transit: false,
      delivered: true,
      delayed: true,
      exception: true,
      cancelled: false,
    },
    delivered: {
      pending: false,
      in_transit: false,
      delivered: false,
      delayed: false,
      exception: false,
      cancelled: false,
    },
    delayed: {
      pending: false,
      in_transit: true,
      delivered: false,
      delayed: false,
      exception: false,
      cancelled: true,
    },
    exception: {
      pending: false,
      in_transit: true,
      delivered: false,
      delayed: false,
      exception: false,
      cancelled: true,
    },
    cancelled: {
      pending: false,
      in_transit: false,
      delivered: false,
      delayed: false,
      exception: false,
      cancelled: false,
    },
  };

  it.each(SHIPMENT_STATUSES.flatMap((from) => SHIPMENT_STATUSES.map((to) => [from, to] as const)))(
    '%s → %s matches the matrix',
    (from, to) => {
      expect(canTransitionShipment(from, to)).toBe(MATRIX[from][to]);
    },
  );

  it('never allows a self-move', () => {
    for (const status of SHIPMENT_STATUSES) {
      expect(canTransitionShipment(status, status)).toBe(false);
    }
  });

  it('treats delivered and cancelled as terminal', () => {
    for (const to of SHIPMENT_STATUSES) {
      expect(canTransitionShipment('delivered', to)).toBe(false);
      expect(canTransitionShipment('cancelled', to)).toBe(false);
    }
  });
});

describe('createShipmentSchema', () => {
  const base = {
    supplierId: '00000000-0000-4000-8000-000000000001',
    purchaseOrderIds: ['00000000-0000-4000-8000-000000000002'],
  };

  it('defaults the shipping cost currency to USD and uppercases codes', () => {
    expect(createShipmentSchema.parse(base).shippingCostCurrency).toBe('USD');
    expect(
      createShipmentSchema.parse({ ...base, shippingCostCurrency: 'nzd' }).shippingCostCurrency,
    ).toBe('NZD');
  });

  it('requires at least one purchase order and a valid tracking URL', () => {
    expect(createShipmentSchema.safeParse({ ...base, purchaseOrderIds: [] }).success).toBe(false);
    expect(createShipmentSchema.safeParse({ ...base, trackingUrl: 'not-a-url' }).success).toBe(
      false,
    );
    expect(
      createShipmentSchema.safeParse({ ...base, trackingUrl: 'https://track.example/x' }).success,
    ).toBe(true);
  });

  it('rejects negative or fractional counts and negative costs', () => {
    expect(createShipmentSchema.safeParse({ ...base, boxCount: -1 }).success).toBe(false);
    expect(createShipmentSchema.safeParse({ ...base, pieceCount: 1.5 }).success).toBe(false);
    expect(createShipmentSchema.safeParse({ ...base, shippingCost: -0.01 }).success).toBe(false);
    expect(
      createShipmentSchema.safeParse({ ...base, boxCount: 0, pieceCount: 40, shippingCost: 120.5 })
        .success,
    ).toBe(true);
  });

  it('rejects malformed ETA dates', () => {
    expect(createShipmentSchema.safeParse({ ...base, etaDate: '12/09/2026' }).success).toBe(false);
    expect(createShipmentSchema.safeParse({ ...base, etaDate: '2026-09-12' }).success).toBe(true);
  });
});

describe('updateShipmentSchema', () => {
  it('accepts null to clear clearable fields', () => {
    const parsed = updateShipmentSchema.parse({
      nickname: null,
      carrier: null,
      trackingNumber: null,
      trackingUrl: null,
      boxCount: null,
      pieceCount: null,
      shippingCost: null,
      etaDate: null,
      notes: null,
    });
    expect(parsed.nickname).toBeNull();
    expect(parsed.etaDate).toBeNull();
  });

  it('does not allow clearing the currency (NOT NULL column)', () => {
    expect(updateShipmentSchema.safeParse({ shippingCostCurrency: null }).success).toBe(false);
    expect(updateShipmentSchema.parse({ shippingCostCurrency: 'aud' }).shippingCostCurrency).toBe(
      'AUD',
    );
  });
});
