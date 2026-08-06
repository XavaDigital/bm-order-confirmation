import { describe, expect, it } from 'vitest';
import {
  BulkNameListError,
  MAX_NAME_LIST_ENTRIES,
  buildNameListTemplateCsv,
  mergeNameListEntries,
  parseNameListCsv,
} from './bulk-name-list';
import type { RosterNameListEntry } from '@/types/customer';

describe('buildNameListTemplateCsv', () => {
  it('produces exactly the headers the parser accepts', () => {
    const template = buildNameListTemplateCsv();
    expect(template).toBe('Name,Number\r\n');
    // Round-trip: the template plus a data row parses cleanly.
    const parsed = parseNameListCsv(`${template}Alex Smith,10\r\n`);
    expect(parsed.rows).toEqual([{ name: 'Alex Smith', playerNumber: '10' }]);
  });
});

describe('parseNameListCsv', () => {
  it('parses names + numbers with the template headers', () => {
    const result = parseNameListCsv('Name,Number\nAlex,7\nBillie,\nCara,12');
    expect(result.rows).toEqual([
      { name: 'Alex', playerNumber: '7' },
      { name: 'Billie', playerNumber: null },
      { name: 'Cara', playerNumber: '12' },
    ]);
    expect(result.skippedBlank).toBe(0);
  });

  it('accepts common header variants and ignores extra columns', () => {
    const result = parseNameListCsv(
      'Player Name,Size,Jersey Number,Email\nAlex,M,7,alex@example.com',
    );
    expect(result.rows).toEqual([{ name: 'Alex', playerNumber: '7' }]);
  });

  it('does not mistake Club/Team/School name columns for the player name', () => {
    const result = parseNameListCsv('Club Name,Name,#\nTigers,Alex,7');
    expect(result.rows).toEqual([{ name: 'Alex', playerNumber: '7' }]);
  });

  it('skips blank-name rows and counts them (fully blank rows are dropped silently)', () => {
    const result = parseNameListCsv('Name,Number\nAlex,7\n,9\n  ,\nBillie,');
    expect(result.rows.map((r) => r.name)).toEqual(['Alex', 'Billie']);
    // ',9' has a number but no name → counted; '  ,' is entirely blank → just dropped.
    expect(result.skippedBlank).toBe(1);
  });

  it('rejects an empty file, a header-only file, a missing Name column, and all-blank names', () => {
    expect(() => parseNameListCsv('')).toThrow(BulkNameListError);
    expect(() => parseNameListCsv('Name,Number\n')).toThrow(/no names/);
    expect(() => parseNameListCsv('Colour,Size\nRed,M')).toThrow(/No "Name" column/);
    expect(() => parseNameListCsv('Name,Number\n,7\n,9')).toThrow(/blank name/);
  });

  it('rejects a file over the entry cap', () => {
    const big = ['Name', ...Array.from({ length: MAX_NAME_LIST_ENTRIES + 1 }, (_, i) => `P${i}`)].join('\n');
    expect(() => parseNameListCsv(big)).toThrow(/limit/);
  });

  it('trims values and caps field lengths', () => {
    const longName = 'x'.repeat(250);
    const result = parseNameListCsv(`Name,Number\n  ${longName}  , 123456789012345678901234 `);
    expect(result.rows[0].name).toHaveLength(200);
    expect(result.rows[0].playerNumber).toHaveLength(20);
  });
});

describe('mergeNameListEntries', () => {
  const existing: RosterNameListEntry[] = [
    { id: 'e1', name: 'Alex', playerNumber: '7' },
    { id: 'e2', name: 'Billie', playerNumber: null },
  ];

  it('appends new rows as id-less entries and keeps existing ones untouched', () => {
    const result = mergeNameListEntries(existing, [
      { name: 'Cara', playerNumber: '12' },
    ]);
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.entries).toEqual([
      ...existing,
      { id: '', name: 'Cara', playerNumber: '12' },
    ]);
  });

  it('skips rows already on the list (case-insensitive name + number) — re-uploading is a no-op', () => {
    const result = mergeNameListEntries(existing, [
      { name: 'ALEX', playerNumber: '7' },
      { name: 'billie', playerNumber: null },
      { name: 'Cara', playerNumber: null },
      { name: 'Cara', playerNumber: null }, // duplicate within the sheet too
    ]);
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(3);
    expect(result.entries.map((e) => e.name)).toEqual(['Alex', 'Billie', 'Cara']);
  });

  it('treats the same name with a DIFFERENT number as a new entry', () => {
    const result = mergeNameListEntries(existing, [{ name: 'Alex', playerNumber: '9' }]);
    expect(result.added).toBe(1);
  });

  it('throws when the merged list would exceed the 300-name cap', () => {
    const many = Array.from({ length: MAX_NAME_LIST_ENTRIES }, (_, i) => ({
      name: `P${i}`,
      playerNumber: null,
    }));
    expect(() => mergeNameListEntries(existing, many)).toThrow(/limit is 300/);
  });
});
