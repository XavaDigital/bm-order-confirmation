/**
 * Team roster CSV/XLSX parsing (TEAM_ROSTER_PLAN.md Phase 4).
 *
 * Uploaded files are untrusted input — parsed server-side only, capped in
 * size and row count before any content is touched. `exceljs` (.xlsx) +
 * `papaparse` (.csv) instead of `xlsx`/SheetJS: the npm-published SheetJS
 * build has unpatched high-severity advisories (prototype pollution, ReDoS)
 * on exactly this attack surface. Legacy binary `.xls` is not supported —
 * exceljs only reads `.xlsx`/`.xlsm`.
 */
import ExcelJS from 'exceljs';
import Papa from 'papaparse';

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_IMPORT_ROWS = 500; // data rows, excluding the header row

export class ImportParseError extends Error {}

export interface ParsedSheet {
  headers: string[];
  /** Data rows only (header excluded), each padded/truncated to headers.length. */
  rows: string[][];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('text' in obj) return String(obj.text ?? '').trim();
    if ('result' in obj) return String(obj.result ?? '').trim();
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return '';
  }
  return String(value).trim();
}

async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ImportParseError('Could not read this file — make sure it is a valid .xlsx file.');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportParseError('The file has no sheets.');

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[]; // 1-indexed; values[0] is unused
    rows.push(values.slice(1).map(cellToString));
  });
  return rows;
}

function parseCsv(buffer: Buffer): string[][] {
  const text = buffer.toString('utf-8');
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  if (result.data.length === 0) {
    throw new ImportParseError('Could not read this file — make sure it is a valid CSV file.');
  }
  return result.data.map((row) => row.map((cell) => String(cell ?? '').trim()));
}

export async function parseRosterFile(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const ext = filename.toLowerCase().split('.').pop();

  let rawRows: string[][];
  if (ext === 'csv') {
    rawRows = parseCsv(buffer);
  } else if (ext === 'xlsx') {
    rawRows = await parseXlsx(buffer);
  } else {
    throw new ImportParseError('Unsupported file type — please upload a .csv or .xlsx file.');
  }

  const nonBlankRows = rawRows.filter((row) => row.some((cell) => cell !== ''));
  if (nonBlankRows.length === 0) throw new ImportParseError('The file is empty.');

  const [headerRow, ...dataRows] = nonBlankRows;
  const headers = headerRow.map((h) => h.trim());

  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new ImportParseError(`This file has ${dataRows.length} rows — the limit is ${MAX_IMPORT_ROWS}.`);
  }

  // Normalize ragged rows (short CSV lines, sparse xlsx trailing cells) to headers.length.
  const rows = dataRows.map((row) => Array.from({ length: headers.length }, (_, i) => row[i] ?? ''));

  return { headers, rows };
}

const NAME_HINTS = /name/i;
const NAME_EXCLUDE_HINTS = /club|team|school|company/i;
const NUMBER_HINTS = /number|jersey|^#$|^no\.?$|^num$/i;
const EMAIL_HINTS = /e-?mail/i;

export interface GuessedMapping {
  nameColumn: number | null;
  playerNumberColumn: number | null;
  emailColumn: number | null;
}

/** Best-effort header → field guess. The user always confirms/corrects before import. */
export function guessColumnMapping(headers: string[]): GuessedMapping {
  const findIndex = (hint: RegExp, exclude?: RegExp) =>
    headers.findIndex((h) => hint.test(h) && !(exclude?.test(h) ?? false));

  const nameColumn = findIndex(NAME_HINTS, NAME_EXCLUDE_HINTS);
  const playerNumberColumn = findIndex(NUMBER_HINTS);
  const emailColumn = findIndex(EMAIL_HINTS);

  return {
    nameColumn: nameColumn === -1 ? null : nameColumn,
    playerNumberColumn: playerNumberColumn === -1 ? null : playerNumberColumn,
    emailColumn: emailColumn === -1 ? null : emailColumn,
  };
}
