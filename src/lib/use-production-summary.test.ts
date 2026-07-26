import { describe, expect, it } from 'vitest';
import type { ProductionPoSummary, ProductionSummary } from '@/types/production';
import { deriveProductionAttention } from './use-production-summary';

function po(overrides: Partial<ProductionPoSummary> = {}): ProductionPoSummary {
  return {
    id: 'po-1',
    poNumber: 'PO-1',
    status: 'sent',
    currentRevisionNumber: 1,
    deadlineDate: null,
    expectedShipDate: null,
    actualShipDate: null,
    sentAt: null,
    receivedAt: null,
    supplier: { id: 's1', name: 'Acme' },
    latestRevision: { revisionNumber: 1, reason: null, createdAt: '2026-07-01T00:00:00Z' },
    variance: { hasVariance: false },
    varianceCounts: { added: 0, modified: 0, removed: 0 },
    ...overrides,
  };
}

function summary(
  purchaseOrders: ProductionPoSummary[],
  coverage: Partial<ProductionSummary['coverage']> = {},
): ProductionSummary {
  return {
    orderId: 'order-1',
    orderNumber: 'OC-1',
    garments: [],
    purchaseOrders,
    coverage: {
      totalRows: 10,
      coveredRows: 10,
      percentage: 100,
      rowToPos: {},
      uncoveredByGarment: {},
      ...coverage,
    },
  };
}

describe('deriveProductionAttention', () => {
  it('needs nothing while the summary is still loading', () => {
    expect(deriveProductionAttention(null).needsAttention).toBe(false);
    expect(deriveProductionAttention(undefined).needsAttention).toBe(false);
  });

  // Before production starts every row is legitimately uncovered — warning then
  // would be noise on every brand-new order.
  it('stays quiet when the order has no purchase orders at all', () => {
    const result = deriveProductionAttention(
      summary([], { totalRows: 10, coveredRows: 0, percentage: 0 }),
    );
    expect(result).toMatchObject({ needsAttention: false, message: null });
  });

  it('stays quiet when the only purchase orders are cancelled', () => {
    const result = deriveProductionAttention(
      summary([po({ status: 'cancelled' })], { totalRows: 10, coveredRows: 0 }),
    );
    expect(result.needsAttention).toBe(false);
  });

  it('stays quiet when a live PO covers everything and matches the order', () => {
    expect(deriveProductionAttention(summary([po()])).needsAttention).toBe(false);
  });

  it('flags uncovered rows once a live PO exists', () => {
    const result = deriveProductionAttention(summary([po()], { totalRows: 10, coveredRows: 7 }));

    expect(result.needsAttention).toBe(true);
    expect(result.uncoveredRows).toBe(3);
    expect(result.message).toBe('3 sizing rows are not covered by a purchase order');
  });

  it('uses the singular form for a single uncovered row', () => {
    const result = deriveProductionAttention(summary([po()], { totalRows: 10, coveredRows: 9 }));
    expect(result.message).toBe('1 sizing row is not covered by a purchase order');
  });

  it('flags a live PO whose snapshot has drifted from the order', () => {
    const result = deriveProductionAttention(
      summary([po({ variance: { hasVariance: true } })]),
    );

    expect(result.needsAttention).toBe(true);
    expect(result.posWithVariance).toBe(1);
    expect(result.message).toBe('1 purchase order has changed since it was issued');
  });

  it('ignores variance on a cancelled PO', () => {
    const result = deriveProductionAttention(
      summary([po({ status: 'cancelled', variance: { hasVariance: true } })]),
    );
    expect(result.needsAttention).toBe(false);
  });

  it('reports both problems together, pluralized', () => {
    const result = deriveProductionAttention(
      summary(
        [
          po({ id: 'po-1', variance: { hasVariance: true } }),
          po({ id: 'po-2', variance: { hasVariance: true } }),
        ],
        { totalRows: 10, coveredRows: 8 },
      ),
    );

    expect(result.message).toBe(
      '2 sizing rows are not covered by a purchase order · 2 purchase orders have changed since they were issued',
    );
  });

  it('never reports negative uncovered rows', () => {
    const result = deriveProductionAttention(summary([po()], { totalRows: 5, coveredRows: 8 }));
    expect(result.uncoveredRows).toBe(0);
  });

  // A shape mismatch must not take the whole order-detail view down.
  it('tolerates a malformed payload', () => {
    const malformed = { configured: false } as unknown as ProductionSummary;
    expect(deriveProductionAttention(malformed).needsAttention).toBe(false);
  });
});
