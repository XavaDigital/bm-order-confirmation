import { describe, expect, it } from 'vitest';
import { buildOrderNoteEnvelope, buildOrderTimelineItem } from './timeline';
import type { OrderNoteEnvelopeInput } from './timeline';

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

/**
 * FLEET_STANDARD_ANNOTATIONS §3/§7 — THE note-envelope serializer. Both
 * transports (outbox push and the capability notes GET/POST) call this one
 * function; these tests pin the shape both therefore share.
 */
describe('buildOrderNoteEnvelope', () => {
  const at = new Date('2026-08-04T10:00:00.000Z');
  function note(overrides: Partial<OrderNoteEnvelopeInput> = {}): OrderNoteEnvelopeInput {
    return {
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      body: 'Sleeves 1cm shorter',
      kind: 'note',
      authorKind: 'email_flow',
      authorLabel: 'Gadine',
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      ...overrides,
    };
  }

  it('keys the envelope on the note ROW uuid with an order subject and staff-only audience', () => {
    expect(buildOrderNoteEnvelope('order-1', note())).toEqual({
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      schemaVersion: 1,
      subject: { type: 'order', id: 'order-1', app: 'bm-orders' },
      kind: 'note',
      body: { text: 'Sleeves 1cm shorter', format: 'plain' },
      author: { kind: 'staff', label: 'Gadine' },
      audience: [],
      occurredAt: '2026-08-04T10:00:00.000Z',
    });
  });

  it('maps email_flow to a staff author (a staff member acting from the email app), label snapshotted', () => {
    expect(buildOrderNoteEnvelope('o', note({ authorKind: 'email_flow' })).author.kind).toBe('staff');
    expect(buildOrderNoteEnvelope('o', note({ authorKind: 'staff' })).author.kind).toBe('staff');
    expect(buildOrderNoteEnvelope('o', note({ authorKind: 'supplier' })).author.kind).toBe('supplier');
    expect(buildOrderNoteEnvelope('o', note({ authorKind: 'system' })).author.kind).toBe('system');
  });

  it('falls back to a Staff label when none was snapshotted (label is REQUIRED per R2)', () => {
    expect(buildOrderNoteEnvelope('o', note({ authorLabel: null })).author.label).toBe('Staff');
  });

  it('sets editedAt only past the same one-second slack the DTO edited flag uses', () => {
    const sameWrite = buildOrderNoteEnvelope(
      'o',
      note({ updatedAt: new Date(at.getTime() + 900) }),
    );
    expect(sameWrite.editedAt).toBeUndefined();

    const edited = buildOrderNoteEnvelope(
      'o',
      note({ updatedAt: new Date('2026-08-04T11:00:00.000Z') }),
    );
    expect(edited.editedAt).toBe('2026-08-04T11:00:00.000Z');
  });

  it('carries the tombstone so caches converge on a delete', () => {
    const gone = buildOrderNoteEnvelope(
      'o',
      note({ deletedAt: new Date('2026-08-04T12:00:00.000Z') }),
    );
    expect(gone.deletedAt).toBe('2026-08-04T12:00:00.000Z');
  });

  it('caps body.text at the §8 64KB limit and never emits a pushRef (delivery id belongs to the push)', () => {
    const env = buildOrderNoteEnvelope('o', note({ body: 'x'.repeat(70_000) }));
    expect(env.body!.text).toHaveLength(64_000);
    expect(env.pushRef).toBeUndefined();
  });
});
