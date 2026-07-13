import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseRosterFile, guessColumnMapping, ImportParseError, MAX_IMPORT_ROWS } from './import';

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Roster');
  rows.forEach((row) => sheet.addRow(row));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('parseRosterFile — CSV', () => {
  it('parses headers and data rows', async () => {
    const buffer = Buffer.from('Name,Number,Email\nAlex,7,alex@example.com\nSam,9,sam@example.com\n');
    const { headers, rows } = await parseRosterFile(buffer, 'roster.csv');

    expect(headers).toEqual(['Name', 'Number', 'Email']);
    expect(rows).toEqual([
      ['Alex', '7', 'alex@example.com'],
      ['Sam', '9', 'sam@example.com'],
    ]);
  });

  it('skips fully blank lines', async () => {
    const buffer = Buffer.from('Name,Number\nAlex,7\n\n\nSam,9\n');
    const { rows } = await parseRosterFile(buffer, 'roster.csv');
    expect(rows).toHaveLength(2);
  });

  it('pads ragged rows to header length', async () => {
    const buffer = Buffer.from('Name,Number,Email\nAlex\n');
    const { rows } = await parseRosterFile(buffer, 'roster.csv');
    expect(rows[0]).toEqual(['Alex', '', '']);
  });

  it('throws ImportParseError when the file is empty', async () => {
    const buffer = Buffer.from('');
    await expect(parseRosterFile(buffer, 'roster.csv')).rejects.toThrow(ImportParseError);
  });

  it('throws ImportParseError when the row cap is exceeded', async () => {
    const lines = ['Name'].concat(Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Player ${i}`));
    const buffer = Buffer.from(lines.join('\n'));
    await expect(parseRosterFile(buffer, 'roster.csv')).rejects.toThrow(ImportParseError);
  });
});

describe('parseRosterFile — XLSX', () => {
  it('parses headers and data rows from a real workbook', async () => {
    const buffer = await buildXlsxBuffer([
      ['Player Name', 'Jersey #', 'Contact Email'],
      ['Alex', '7', 'alex@example.com'],
      ['Sam', '9', 'sam@example.com'],
    ]);
    const { headers, rows } = await parseRosterFile(buffer, 'roster.xlsx');

    expect(headers).toEqual(['Player Name', 'Jersey #', 'Contact Email']);
    expect(rows).toEqual([
      ['Alex', '7', 'alex@example.com'],
      ['Sam', '9', 'sam@example.com'],
    ]);
  });

  it('converts numeric cells to strings', async () => {
    const buffer = await buildXlsxBuffer([
      ['Name', 'Number'],
      ['Alex', 7],
    ]);
    const { rows } = await parseRosterFile(buffer, 'roster.xlsx');
    expect(rows[0]).toEqual(['Alex', '7']);
  });

  it('throws ImportParseError for a corrupt buffer', async () => {
    const buffer = Buffer.from('not a real xlsx file');
    await expect(parseRosterFile(buffer, 'roster.xlsx')).rejects.toThrow(ImportParseError);
  });
});

describe('parseRosterFile — unsupported extension', () => {
  it('throws ImportParseError for an unrecognized file type', async () => {
    const buffer = Buffer.from('whatever');
    await expect(parseRosterFile(buffer, 'roster.xls')).rejects.toThrow(ImportParseError);
  });
});

describe('guessColumnMapping', () => {
  it('finds Name, Number, Email columns by header keywords', () => {
    const mapping = guessColumnMapping(['Player Name', 'Jersey Number', 'Email Address']);
    expect(mapping).toEqual({ nameColumn: 0, playerNumberColumn: 1, emailColumn: 2 });
  });

  it('excludes club/team name columns from the name guess', () => {
    const mapping = guessColumnMapping(['Club Name', 'Player Name', 'Number']);
    expect(mapping.nameColumn).toBe(1);
  });

  it('returns null for fields with no matching header', () => {
    const mapping = guessColumnMapping(['Col A', 'Col B']);
    expect(mapping).toEqual({ nameColumn: null, playerNumberColumn: null, emailColumn: null });
  });

  it('matches a bare "#" header for the number column', () => {
    const mapping = guessColumnMapping(['Name', '#']);
    expect(mapping.playerNumberColumn).toBe(1);
  });
});
