import { describe, expect, it } from 'vitest';
import {
  PO_STATUSES,
  canTransition,
  createPurchaseOrderSchema,
  issueRevisionSchema,
  updatePurchaseOrderSchema,
  type PoStatus,
} from './contract';

// David's 2026-08-05 production vocabulary: approved after draft,
// test_print/prod_layout after pre_production, quality_control after
// in_production.
const CHAIN: PoStatus[] = [
  'draft',
  'approved',
  'sent',
  'confirmed',
  'pre_production',
  'test_print',
  'prod_layout',
  'in_production',
  'quality_control',
  'in_transit',
  'received',
  'completed',
];

const CANCELLABLE: PoStatus[] = [
  'draft',
  'approved',
  'sent',
  'confirmed',
  'pre_production',
  'test_print',
  'prod_layout',
];

/** The complete legal-transition set, built independently of the implementation. */
function legalPairs(): Set<string> {
  const legal = new Set<string>();
  // Forward chain moves, jumps included.
  for (let i = 0; i < CHAIN.length; i++) {
    for (let j = i + 1; j < CHAIN.length; j++) legal.add(`${CHAIN[i]}→${CHAIN[j]}`);
  }
  // Cancellation window — up to and including the design-prep phases.
  for (const from of CANCELLABLE) legal.add(`${from}→cancelled`);
  // Remake entry and re-entry into production.
  legal.add('received→remake');
  legal.add('completed→remake');
  legal.add('remake→pre_production');
  legal.add('remake→in_production');
  return legal;
}

describe('canTransition', () => {
  it('matches the expected matrix for every from/to pair (exhaustive)', () => {
    const legal = legalPairs();
    for (const from of PO_STATUSES) {
      for (const to of PO_STATUSES) {
        expect
          .soft(canTransition(from, to), `${from} → ${to}`)
          .toBe(legal.has(`${from}→${to}`));
      }
    }
  });

  it('allows each single forward step along the chain', () => {
    for (let i = 0; i < CHAIN.length - 1; i++) {
      expect(canTransition(CHAIN[i], CHAIN[i + 1])).toBe(true);
    }
  });

  it('allows forward jumps', () => {
    // A draft can go straight to sent — approval is enforced by the SEND
    // action (sendPurchaseOrder), not baked into the status machine.
    expect(canTransition('draft', 'sent')).toBe(true);
    expect(canTransition('draft', 'in_production')).toBe(true);
    expect(canTransition('sent', 'received')).toBe(true);
    expect(canTransition('draft', 'completed')).toBe(true);
    expect(canTransition('quality_control', 'in_transit')).toBe(true);
  });

  it('spot-checks the new 2026-08-05 statuses', () => {
    expect(canTransition('draft', 'approved')).toBe(true);
    expect(canTransition('approved', 'sent')).toBe(true);
    expect(canTransition('approved', 'cancelled')).toBe(true);
    expect(canTransition('test_print', 'prod_layout')).toBe(true);
    expect(canTransition('prod_layout', 'test_print')).toBe(false); // backward
    expect(canTransition('in_production', 'quality_control')).toBe(true);
    expect(canTransition('quality_control', 'in_transit')).toBe(true);
    expect(canTransition('in_transit', 'quality_control')).toBe(false); // backward
  });

  it('rejects backward moves', () => {
    expect(canTransition('sent', 'draft')).toBe(false);
    expect(canTransition('approved', 'draft')).toBe(false);
    expect(canTransition('sent', 'approved')).toBe(false);
    expect(canTransition('received', 'in_transit')).toBe(false);
    expect(canTransition('in_production', 'confirmed')).toBe(false);
    expect(canTransition('prod_layout', 'pre_production')).toBe(false);
  });

  it('rejects self-transitions', () => {
    for (const status of PO_STATUSES) expect(canTransition(status, status)).toBe(false);
  });

  it('allows cancellation only before production is underway', () => {
    for (const from of CANCELLABLE) {
      expect(canTransition(from, 'cancelled'), `${from} → cancelled`).toBe(true);
    }
    expect(canTransition('in_production', 'cancelled')).toBe(false);
    expect(canTransition('quality_control', 'cancelled')).toBe(false);
    expect(canTransition('in_transit', 'cancelled')).toBe(false);
    expect(canTransition('received', 'cancelled')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('remake', 'cancelled')).toBe(false);
  });

  it('treats cancelled as terminal', () => {
    for (const to of PO_STATUSES) expect(canTransition('cancelled', to)).toBe(false);
  });

  it('allows remake only from received or completed', () => {
    expect(canTransition('received', 'remake')).toBe(true);
    expect(canTransition('completed', 'remake')).toBe(true);
    for (const from of PO_STATUSES) {
      if (from === 'received' || from === 'completed') continue;
      expect(canTransition(from, 'remake')).toBe(false);
    }
  });

  it('re-enters production from remake (and nowhere else)', () => {
    expect(canTransition('remake', 'pre_production')).toBe(true);
    expect(canTransition('remake', 'in_production')).toBe(true);
    for (const to of PO_STATUSES) {
      if (to === 'pre_production' || to === 'in_production') continue;
      expect(canTransition('remake', to)).toBe(false);
    }
  });

  it('lets nothing out of completed except remake', () => {
    for (const to of PO_STATUSES) {
      expect(canTransition('completed', to)).toBe(to === 'remake');
    }
  });
});

describe('schemas', () => {
  const uuid = '00000000-0000-4000-8000-000000000000';

  it('createPurchaseOrderSchema requires at least one garment id and valid dates', () => {
    expect(
      createPurchaseOrderSchema.safeParse({ orderId: uuid, supplierId: uuid, garmentIds: [] })
        .success,
    ).toBe(false);
    expect(
      createPurchaseOrderSchema.safeParse({
        orderId: uuid,
        supplierId: uuid,
        garmentIds: [uuid],
        expectedShipDate: 'not-a-date',
      }).success,
    ).toBe(false);
    expect(
      createPurchaseOrderSchema.safeParse({
        orderId: uuid,
        supplierId: uuid,
        garmentIds: [uuid],
        expectedShipDate: '2026-08-01',
        notes: 'rush job',
      }).success,
    ).toBe(true);
  });

  it('createPurchaseOrderSchema no longer accepts deadlineDate — the PO mirrors the order', () => {
    const parsed = createPurchaseOrderSchema.parse({
      orderId: uuid,
      supplierId: uuid,
      garmentIds: [uuid],
      deadlineDate: '2026-09-01', // stripped: not part of the contract anymore
    });
    expect(parsed).not.toHaveProperty('deadlineDate');
  });

  it('updatePurchaseOrderSchema accepts nulls to clear fields and a direct deadlineDate', () => {
    // deadlineDate became directly settable on 2026-08-06 (David) — it still
    // auto-imports from the order and re-syncs on order changes, last write
    // wins, but the PATCH may set or clear it explicitly.
    const parsed = updatePurchaseOrderSchema.parse({
      expectedShipDate: null,
      notes: null,
      deadlineDate: '2026-09-01',
    });
    expect(parsed).toEqual({
      expectedShipDate: null,
      notes: null,
      deadlineDate: '2026-09-01',
    });
    expect(updatePurchaseOrderSchema.parse({ deadlineDate: null })).toEqual({
      deadlineDate: null,
    });
  });

  it('issueRevisionSchema requires a non-blank reason and trims it', () => {
    expect(issueRevisionSchema.safeParse({}).success).toBe(false);
    expect(issueRevisionSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(issueRevisionSchema.parse({ reason: '  sizes changed  ' }).reason).toBe(
      'sizes changed',
    );
    expect(issueRevisionSchema.safeParse({ reason: 'x', garmentIds: [] }).success).toBe(false);
  });
});
