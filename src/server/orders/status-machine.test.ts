import { describe, expect, it } from 'vitest';
import { ORDER_STATUS, type OrderStatus } from '@/lib/status';
import {
  canTransitionOrder,
  explainOrderTransition,
  isStaffMovable,
} from './status-machine';

const ALL = Object.keys(ORDER_STATUS) as OrderStatus[];

/**
 * The full matrix, spelled out. A transition table is exactly the kind of thing
 * that looks obviously right and has a hole in it, so every cell is asserted
 * rather than a sample.
 */
const LEGAL: Record<OrderStatus, OrderStatus[]> = {
  draft: ['draft', 'sent', 'cancelled'],
  sent: ['sent', 'viewed', 'changes_requested', 'confirmed', 'cancelled'],
  viewed: ['viewed', 'sent', 'changes_requested', 'confirmed', 'cancelled'],
  changes_requested: ['changes_requested', 'sent', 'viewed', 'confirmed', 'cancelled'],
  confirmed: ['confirmed', 'cancelled'],
  cancelled: ['cancelled'],
};

describe('canTransitionOrder — full matrix', () => {
  it.each(ALL)('from %s, exactly the expected targets are legal', (from) => {
    const actual = ALL.filter((to) => canTransitionOrder(from, to)).sort();
    expect(actual).toEqual([...LEGAL[from]].sort());
  });

  it('allows every status to stay where it is', () => {
    for (const status of ALL) {
      expect(canTransitionOrder(status, status)).toBe(true);
    }
  });

  // The specific hole this module was written to close.
  it.each(['draft', 'sent', 'viewed', 'changes_requested'] as OrderStatus[])(
    'refuses to revert a confirmed order to %s',
    (to) => {
      expect(canTransitionOrder('confirmed', to)).toBe(false);
    },
  );

  it('treats cancelled as terminal', () => {
    for (const to of ALL.filter((s) => s !== 'cancelled')) {
      expect(canTransitionOrder('cancelled', to)).toBe(false);
    }
  });

  it('allows cancelling from anywhere except cancelled', () => {
    for (const from of ALL.filter((s) => s !== 'cancelled')) {
      expect(canTransitionOrder(from, 'cancelled')).toBe(true);
    }
  });

  // Re-sending after an edit is the normal path back to the customer.
  it('allows re-sending from viewed and changes_requested', () => {
    expect(canTransitionOrder('viewed', 'sent')).toBe(true);
    expect(canTransitionOrder('changes_requested', 'sent')).toBe(true);
  });
});

describe('isStaffMovable — what a human may drag', () => {
  // Confirmation carries a signature and a snapshot; dragging a card must never
  // be able to manufacture one.
  it('never lets staff move an order into confirmed', () => {
    for (const from of ALL) {
      if (from === 'confirmed') continue;
      expect(isStaffMovable(from, 'confirmed')).toBe(false);
    }
  });

  // "Viewed" is an observed fact about the customer, not a claim staff can make.
  it('never lets staff move an order into viewed', () => {
    for (const from of ALL) {
      if (from === 'viewed') continue;
      expect(isStaffMovable(from, 'viewed')).toBe(false);
    }
  });

  it('is never more permissive than the lifecycle itself', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        if (isStaffMovable(from, to)) {
          expect(canTransitionOrder(from, to)).toBe(true);
        }
      }
    }
  });

  it('still allows the moves staff genuinely own', () => {
    expect(isStaffMovable('draft', 'sent')).toBe(true);
    expect(isStaffMovable('viewed', 'sent')).toBe(true);
    expect(isStaffMovable('changes_requested', 'sent')).toBe(true);
    expect(isStaffMovable('sent', 'cancelled')).toBe(true);
    expect(isStaffMovable('confirmed', 'cancelled')).toBe(true);
  });
});

describe('explainOrderTransition', () => {
  it('returns null when the move is allowed', () => {
    expect(explainOrderTransition('draft', 'sent')).toBeNull();
    expect(explainOrderTransition('sent', 'sent')).toBeNull();
  });

  // A rejected drag opens a dialog with this text, so it has to say which of the
  // two different reasons applied.
  it('explains that confirmation belongs to the customer', () => {
    expect(explainOrderTransition('sent', 'confirmed')).toMatch(/only the customer/i);
  });

  it('explains that viewed is observed, not set', () => {
    expect(explainOrderTransition('sent', 'viewed')).toMatch(/opens their link/i);
  });

  it('explains that a cancelled order is done', () => {
    expect(explainOrderTransition('cancelled', 'draft')).toMatch(/duplicate it instead/i);
  });

  it('explains that a confirmed order can only be cancelled', () => {
    expect(explainOrderTransition('confirmed', 'draft')).toMatch(/only be cancelled/i);
  });

  it('always explains something when a move is refused', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        if (isStaffMovable(from, to)) continue;
        expect(explainOrderTransition(from, to)).toBeTruthy();
      }
    }
  });
});
