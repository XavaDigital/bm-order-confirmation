import { describe, expect, it } from 'vitest';
import { buildOrderTimelineItem } from './timeline';

/**
 * v1 timeline vocabulary (fleet thread 2026-07-31): lifecycle events only.
 * Direction is who acted — created is ours, confirmed/changes_requested are
 * the customer's.
 */
describe('buildOrderTimelineItem', () => {
  it('files created as our outbound act with no snippet', () => {
    expect(buildOrderTimelineItem('created', 'BM-10023')).toEqual({
      direction: 'outbound',
      subject: 'Order BM-10023 created',
      snippet: null,
    });
  });

  it('files confirmed as the customer acting', () => {
    expect(buildOrderTimelineItem('confirmed', 'BM-10023')).toEqual({
      direction: 'inbound',
      subject: 'Order BM-10023 confirmed',
      snippet: 'The customer confirmed the order.',
    });
  });

  it('carries the customer comment as the changes_requested snippet', () => {
    expect(buildOrderTimelineItem('changes_requested', 'BM-10023', 'Wrong sizes')).toEqual({
      direction: 'inbound',
      subject: 'Order BM-10023: changes requested',
      snippet: 'Wrong sizes',
    });
  });

  it('tolerates a missing comment and a missing order number', () => {
    expect(buildOrderTimelineItem('changes_requested', null)).toEqual({
      direction: 'inbound',
      subject: 'Order: changes requested',
      snippet: null,
    });
  });

  // The hub stores "first 500 chars" — we pre-truncate rather than rely on it.
  it('truncates the snippet at 500 characters', () => {
    const item = buildOrderTimelineItem('changes_requested', 'BM-10023', 'x'.repeat(600));
    expect(item.snippet).toHaveLength(500);
  });
});
