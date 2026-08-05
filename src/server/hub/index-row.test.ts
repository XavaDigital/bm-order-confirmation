import { describe, expect, it } from 'vitest';
import { orderIndexChip } from './index-row';

/**
 * The 2026-08-05 PO vocabulary against the PINNED chip vocabulary (fleet
 * thread 2026-07-31 — the chip set itself must not grow). The new statuses
 * fold onto the coarse scale before aggregation; the broader chip behavior is
 * covered in order-sync.test.ts.
 */
describe('orderIndexChip — 2026-08-05 PO statuses', () => {
  it('treats approved as pre-production paperwork, not production', () => {
    // Same as draft/sent: the factory has nothing yet.
    expect(orderIndexChip('confirmed', ['approved'])).toBe('confirmed');
    expect(orderIndexChip('confirmed', ['approved', 'sent'])).toBe('confirmed');
  });

  it('reads the design-prep phases as in_production', () => {
    expect(orderIndexChip('confirmed', ['test_print'])).toBe('in_production');
    expect(orderIndexChip('confirmed', ['prod_layout'])).toBe('in_production');
  });

  it('reads quality_control as in_production', () => {
    expect(orderIndexChip('confirmed', ['quality_control'])).toBe('in_production');
  });

  it('folds before aggregating, so the least-advanced PO still wins', () => {
    // An approved straggler holds the order back from reading in_production.
    expect(orderIndexChip('confirmed', ['approved', 'quality_control'])).toBe('confirmed');
    // A quality_control straggler holds the order back from completed.
    expect(orderIndexChip('confirmed', ['completed', 'quality_control'])).toBe('in_production');
    expect(orderIndexChip('confirmed', ['test_print', 'in_transit'])).toBe('in_production');
  });

  it('still refuses vocabulary it cannot map rather than guessing', () => {
    // Unknown PO statuses → null aggregate → the safe pre-production chip;
    // an unknown ORDER status stays null so the caller pushes the raw value.
    expect(orderIndexChip('confirmed', ['some_future_status'])).toBe('confirmed');
    expect(orderIndexChip('some_future_status', [])).toBeNull();
  });
});
