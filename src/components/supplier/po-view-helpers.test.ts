import { describe, expect, it } from 'vitest';
import type { PoSnapshotLine } from '@/db/schema';
import {
  buildActivityFeed,
  garmentUnits,
  isImageFileName,
  isShipDateLocked,
  lineColumnDescriptors,
  matchesPoSearch,
  optionEntries,
  summarizeStatusResults,
} from './po-view-helpers';

function line(overrides: Partial<PoSnapshotLine> = {}): PoSnapshotLine {
  return {
    sizingRowId: 'r-1',
    size: 'M',
    playerName: 'Alex',
    playerNumber: '7',
    notes: null,
    ...overrides,
  };
}

describe('optionEntries', () => {
  it('returns every key, INCLUDING blank values (options must always display)', () => {
    expect(optionEntries({ 'Zip Type': 'pullover', Trim: '', Collar: '  ' })).toEqual([
      { label: 'Zip Type', value: 'pullover' },
      { label: 'Trim', value: '' },
      { label: 'Collar', value: '' },
    ]);
  });

  it('returns an empty list for a null/absent map', () => {
    expect(optionEntries(null)).toEqual([]);
    expect(optionEntries(undefined)).toEqual([]);
  });
});

describe('lineColumnDescriptors', () => {
  it('always includes every captured sizing column between Qty and Notes', () => {
    const descriptors = lineColumnDescriptors({
      sizingColumns: [
        { label: 'Colour', type: 'text' },
        { label: 'Variation', type: 'select', options: ['A', 'B'] },
      ],
    });
    expect(descriptors.map((d) => d.label)).toEqual([
      'Size',
      'Player Name',
      'Number',
      'Qty',
      'Colour',
      'Variation',
      'Notes',
    ]);
  });

  it('tolerates revisions cut before sizing columns existed', () => {
    expect(lineColumnDescriptors({}).map((d) => d.label)).toEqual([
      'Size',
      'Player Name',
      'Number',
      'Qty',
      'Notes',
    ]);
  });

  it('reads custom values off the line and blanks missing ones', () => {
    const descriptors = lineColumnDescriptors({ sizingColumns: [{ label: 'Colour', type: 'text' }] });
    const colour = descriptors.find((d) => d.key === 'custom:Colour')!;
    expect(colour.getValue(line({ customValues: { Colour: 'Red' } }))).toBe('Red');
    expect(colour.getValue(line({ customValues: null }))).toBe('');
  });

  it('treats a missing quantity as 1 (pre-0025 revisions)', () => {
    const qty = lineColumnDescriptors({}).find((d) => d.key === 'quantity')!;
    expect(qty.getValue(line())).toBe('1');
    expect(qty.getValue(line({ quantity: 4 }))).toBe('4');
  });
});

describe('garmentUnits', () => {
  it('sums quantities, defaulting a missing one to 1', () => {
    expect(garmentUnits({ lines: [line(), line({ quantity: 3 })] })).toBe(4);
    expect(garmentUnits({ lines: [] })).toBe(0);
  });
});

describe('matchesPoSearch', () => {
  const row = { poNumber: 'PO-2607-DY01-DYNASTY', garmentNames: ['Home Jersey', 'Shorts'] };

  it('matches PO number and garment names case-insensitively', () => {
    expect(matchesPoSearch(row, 'dy01')).toBe(true);
    expect(matchesPoSearch(row, 'jersey')).toBe(true);
    expect(matchesPoSearch(row, 'SHORTS')).toBe(true);
  });

  it('rejects non-matches and accepts everything on an empty query', () => {
    expect(matchesPoSearch(row, 'hoodie')).toBe(false);
    expect(matchesPoSearch(row, '')).toBe(true);
    expect(matchesPoSearch(row, '   ')).toBe(true);
  });
});

describe('summarizeStatusResults', () => {
  it('splits successes from labelled failures', () => {
    expect(
      summarizeStatusResults([
        { poNumber: 'PO-1', ok: true },
        { poNumber: 'PO-2', ok: false, error: 'Not found' },
        { poNumber: 'PO-3', ok: false },
      ]),
    ).toEqual({
      okCount: 1,
      failures: ['PO-2: Not found', 'PO-3: Update failed'],
    });
  });
});

describe('buildActivityFeed', () => {
  const comment = (id: string, createdAt: string) => ({ id, createdAt });
  const file = (id: string, createdAt: string) => ({ id, createdAt });
  const status = (to: string, at: string) => ({ from: 'sent', to, at, by: null });

  it('merges comments, files and status changes oldest-first', () => {
    const feed = buildActivityFeed({
      comments: [comment('c1', '2026-08-03T10:00:00Z'), comment('c2', '2026-08-01T10:00:00Z')],
      files: [file('f1', '2026-08-02T10:00:00Z')],
      statusChanges: [status('pre_production', '2026-08-04T10:00:00Z')],
    });
    expect(feed.map((e) => e.kind)).toEqual(['comment', 'file', 'comment', 'status']);
    expect(feed[0]).toMatchObject({ kind: 'comment', comment: { id: 'c2' } });
    expect(feed[1]).toMatchObject({ kind: 'file', file: { id: 'f1' } });
    expect(feed[3]).toMatchObject({ kind: 'status', change: { to: 'pre_production' } });
  });

  it('breaks timestamp ties status → file → comment (the line that opened a stage reads first)', () => {
    const at = '2026-08-05T09:00:00Z';
    const feed = buildActivityFeed({
      comments: [comment('c1', at)],
      files: [file('f1', at)],
      statusChanges: [status('test_print', at)],
    });
    expect(feed.map((e) => e.kind)).toEqual(['status', 'file', 'comment']);
  });

  it('keeps input order for same-kind ties (stable)', () => {
    const at = '2026-08-05T09:00:00Z';
    const feed = buildActivityFeed({
      comments: [comment('c1', at), comment('c2', at)],
    });
    expect(feed.map((e) => (e.kind === 'comment' ? e.comment.id : ''))).toEqual(['c1', 'c2']);
  });

  it('tolerates absent files/statuses (the token surface) and bad timestamps', () => {
    expect(buildActivityFeed({ comments: [] })).toEqual([]);
    const feed = buildActivityFeed({
      comments: [comment('good', '2026-08-01T10:00:00Z'), comment('bad', 'not-a-date')],
    });
    // Unparseable timestamps sort to the start rather than throwing.
    expect(feed.map((e) => (e.kind === 'comment' ? e.comment.id : ''))).toEqual(['bad', 'good']);
  });
});

describe('isImageFileName', () => {
  it('accepts common image extensions case-insensitively', () => {
    for (const name of ['test.png', 'PRINT.JPG', 'a.jpeg', 'b.webp', 'c.gif', 'd.svg']) {
      expect(isImageFileName(name)).toBe(true);
    }
  });

  it('rejects non-images and extension-less names', () => {
    for (const name of ['layout.pdf', 'design.ai', 'archive.zip', 'noext', 'font.ttf']) {
      expect(isImageFileName(name)).toBe(false);
    }
  });
});

describe('isShipDateLocked', () => {
  it('locks every status from shipping onward and nothing before', () => {
    for (const status of ['in_transit', 'received', 'completed', 'remake', 'cancelled']) {
      expect(isShipDateLocked(status)).toBe(true);
    }
    for (const status of ['sent', 'pre_production', 'test_print', 'in_production', 'quality_control']) {
      expect(isShipDateLocked(status)).toBe(false);
    }
  });
});
