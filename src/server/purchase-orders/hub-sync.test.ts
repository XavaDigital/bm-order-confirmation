import { describe, expect, it } from 'vitest';
import { aggregateProductionStatus } from './hub-sync';

describe('aggregateProductionStatus', () => {
  it('returns null when there are no POs', () => {
    expect(aggregateProductionStatus([])).toBeNull();
  });

  it('returns null when every PO is cancelled', () => {
    expect(aggregateProductionStatus(['cancelled', 'cancelled'])).toBeNull();
  });

  it('reports the least-advanced non-cancelled PO', () => {
    expect(aggregateProductionStatus(['in_transit', 'pre_production', 'completed'])).toBe(
      'pre_production',
    );
    expect(aggregateProductionStatus(['sent', 'draft'])).toBe('draft');
  });

  it('ignores cancelled POs in the aggregate', () => {
    expect(aggregateProductionStatus(['cancelled', 'in_production'])).toBe('in_production');
  });

  it('ranks remake as in_production', () => {
    expect(aggregateProductionStatus(['remake', 'completed'])).toBe('in_production');
    expect(aggregateProductionStatus(['remake', 'sent'])).toBe('sent');
  });

  it('reaches completed only when every active PO is completed', () => {
    expect(aggregateProductionStatus(['completed', 'completed'])).toBe('completed');
    expect(aggregateProductionStatus(['completed', 'received'])).toBe('received');
    expect(aggregateProductionStatus(['completed', 'cancelled'])).toBe('completed');
  });

  it('returns null on an unknown status rather than guessing', () => {
    expect(aggregateProductionStatus(['completed', 'weird_future_status'])).toBeNull();
  });
});
