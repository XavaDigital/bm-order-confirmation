import { describe, expect, it } from 'vitest';
import {
  buildImportedRows,
  detectDelimiter,
  guessColumnTargets,
  looksLikeHeaderRow,
  parseDelimited,
  targetLabel,
} from './sizing-paste-import';

describe('detectDelimiter', () => {
  it('prefers tab whenever any tab is present (spreadsheet paste)', () => {
    expect(detectDelimiter('M\tAlice, Jr\t7')).toBe('\t');
  });

  it('falls back to comma when there are no tabs', () => {
    expect(detectDelimiter('M,Alice,7')).toBe(',');
  });
});

describe('parseDelimited', () => {
  it('parses tab-separated rows and trims cells', () => {
    expect(parseDelimited('M\t Alice \t7\nL\tBob\t9')).toEqual([
      ['M', 'Alice', '7'],
      ['L', 'Bob', '9'],
    ]);
  });

  it('parses CSV with quoted cells, embedded commas and "" escapes', () => {
    expect(parseDelimited('M,"Smith, Alice","Says ""hi"""')).toEqual([
      ['M', 'Smith, Alice', 'Says "hi"'],
    ]);
  });

  it('handles CRLF line endings and drops empty lines', () => {
    expect(parseDelimited('M\tAlice\r\n\r\n\t\r\nL\tBob\r\n')).toEqual([
      ['M', 'Alice'],
      ['L', 'Bob'],
    ]);
  });

  it('keeps a newline inside a quoted CSV cell in one cell', () => {
    expect(parseDelimited('M,"line one\nline two",7')).toEqual([
      ['M', 'line one\nline two', '7'],
    ]);
  });
});

describe('looksLikeHeaderRow', () => {
  it('recognises common header spellings', () => {
    expect(looksLikeHeaderRow(['Size', 'Player Name', '#'])).toBe(true);
    expect(looksLikeHeaderRow(['SIZE', 'name'])).toBe(true);
  });

  it('recognises a custom column label as a header', () => {
    expect(looksLikeHeaderRow(['Sponsor', 'Whatever'], ['Sponsor'])).toBe(true);
  });

  it('treats a plain data row as not-a-header', () => {
    expect(looksLikeHeaderRow(['M', 'Alice', '7'])).toBe(false);
    expect(looksLikeHeaderRow(undefined)).toBe(false);
  });
});

describe('guessColumnTargets', () => {
  it('maps headers by alias, case-insensitively', () => {
    expect(
      guessColumnTargets(['SIZE', 'Player Name', 'Jersey #', 'Qty', 'Comments'], 5),
    ).toEqual(['size', 'playerName', 'playerNumber', 'quantity', 'notes']);
  });

  it('maps a header matching a custom column label to that column', () => {
    expect(guessColumnTargets(['Size', 'Sponsor'], 2, [{ label: 'Sponsor' }])).toEqual([
      'size',
      'custom:Sponsor',
    ]);
  });

  it('ignores unmatched headers rather than dumping them somewhere', () => {
    expect(guessColumnTargets(['Size', 'Paid?'], 2)).toEqual(['size', null]);
  });

  it('keeps only the first of two columns matching the same target', () => {
    expect(guessColumnTargets(['Name', 'Player'], 2)).toEqual(['playerName', null]);
  });

  it('falls back to the table order positionally when there are no headers', () => {
    expect(guessColumnTargets(null, 6, [{ label: 'Colour' }])).toEqual([
      'size',
      'playerName',
      'playerNumber',
      'quantity',
      'custom:Colour',
      'notes',
    ]);
  });

  it('ignores extra positional columns beyond the table order', () => {
    expect(guessColumnTargets(null, 7)).toEqual([
      'size',
      'playerName',
      'playerNumber',
      'quantity',
      'notes',
      null,
      null,
    ]);
  });
});

describe('buildImportedRows', () => {
  it('applies the mapping, including custom columns', () => {
    const rows = buildImportedRows(
      [
        ['M', 'Alice', '7', 'Acme'],
        ['L', 'Bob', '9', ''],
      ],
      ['size', 'playerName', 'playerNumber', 'custom:Sponsor'],
    );
    expect(rows).toEqual([
      { size: 'M', playerName: 'Alice', playerNumber: '7', quantity: '', notes: '', customValues: { Sponsor: 'Acme' } },
      { size: 'L', playerName: 'Bob', playerNumber: '9', quantity: '', notes: '', customValues: {} },
    ]);
  });

  it('skips cells in ignored columns', () => {
    const rows = buildImportedRows([['M', 'yes', 'Alice']], ['size', null, 'playerName']);
    expect(rows).toEqual([
      { size: 'M', playerName: 'Alice', playerNumber: '', quantity: '', notes: '', customValues: {} },
    ]);
  });

  it('drops rows whose mapped cells are all empty', () => {
    const rows = buildImportedRows(
      [
        ['', '', 'ignored-only-value'],
        ['M', '', ''],
      ],
      ['size', 'playerName', null],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].size).toBe('M');
  });

  it('tolerates short rows (missing trailing cells)', () => {
    const rows = buildImportedRows([['M']], ['size', 'playerName', 'notes']);
    expect(rows).toEqual([
      { size: 'M', playerName: '', playerNumber: '', quantity: '', notes: '', customValues: {} },
    ]);
  });
});

describe('targetLabel', () => {
  it('labels fixed targets and unwraps custom ones', () => {
    expect(targetLabel('playerName')).toBe('Player Name');
    expect(targetLabel('custom:Sponsor')).toBe('Sponsor');
  });
});
