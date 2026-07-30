import { describe, expect, it } from 'vitest';
import { orderIndexChip } from './order-sync';

/**
 * The chip is the pinned fleet vocabulary (thread 2026-07-31): the order enum
 * verbatim until confirmed, then the PO aggregate — where "in production" is
 * anything from pre-production to received, and completed only when ALL POs
 * are. The CRM chip answers "where is it", not "which internal stage".
 */
describe('orderIndexChip', () => {
  it.each(['draft', 'sent', 'viewed', 'changes_requested', 'cancelled'] as const)(
    'passes %s through before confirmation',
    (status) => {
      expect(orderIndexChip(status, [])).toBe(status);
    },
  );

  it('reads confirmed with no POs', () => {
    expect(orderIndexChip('confirmed', [])).toBe('confirmed');
  });

  it('stays confirmed while POs are only drafted or sent', () => {
    expect(orderIndexChip('confirmed', ['draft'])).toBe('confirmed');
    expect(orderIndexChip('confirmed', ['sent', 'confirmed'])).toBe('confirmed');
  });

  it('reads in_production once the least-advanced PO is in pre-production or beyond', () => {
    expect(orderIndexChip('confirmed', ['pre_production'])).toBe('in_production');
    expect(orderIndexChip('confirmed', ['in_transit', 'completed'])).toBe('in_production');
    expect(orderIndexChip('confirmed', ['received'])).toBe('in_production');
  });

  // The least-advanced PO wins — one straggler keeps the whole order back.
  it('does not read completed until every PO is', () => {
    expect(orderIndexChip('confirmed', ['completed', 'in_production'])).toBe('in_production');
    expect(orderIndexChip('confirmed', ['completed', 'completed'])).toBe('completed');
  });

  it('ignores cancelled POs and treats remake as production', () => {
    expect(orderIndexChip('confirmed', ['cancelled', 'completed'])).toBe('completed');
    expect(orderIndexChip('confirmed', ['remake'])).toBe('in_production');
  });

  // Unknown vocabulary → null, so the caller pushes nothing rather than lying.
  it('returns null for a status it cannot map', () => {
    expect(orderIndexChip('some_future_status', [])).toBeNull();
  });
});
