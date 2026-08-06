/**
 * Pure parsing/mapping logic for the sizing-table paste import (David,
 * 2026-08-06: "there appears to be no way to import the information into the
 * sizing table"). Staff paste rows copied from Excel / Google Sheets (TSV) or
 * a CSV export; this module turns the text into sizing-row shapes the
 * SizingTable can append client-side — persistence stays with the normal
 * "Save sizing" path, no server routes involved.
 *
 * Kept free of React/antd so it can be unit-tested directly.
 */
import type { GarmentTypeOption } from '@/db/schema';

/** Where one pasted column's values land. `custom:<label>` targets one of the
 *  garment's user-defined sizing columns; null means "ignore this column". */
export type ImportTarget =
  | 'size'
  | 'playerName'
  | 'playerNumber'
  | 'quantity'
  | 'notes'
  | `custom:${string}`;

/** One parsed row in the shape SizingTable keeps rows in while editing
 *  (strings throughout; quantity is parsed on save by the table itself). */
export interface ImportedSizingRow {
  size: string;
  playerName: string;
  playerNumber: string;
  quantity: string;
  notes: string;
  customValues: Record<string, string>;
}

export type Delimiter = '\t' | ',';

/** Tab wins whenever present — a spreadsheet paste is always TSV, and player
 *  names/notes may legitimately contain commas. */
export function detectDelimiter(text: string): Delimiter {
  return text.includes('\t') ? '\t' : ',';
}

/**
 * Split pasted text into trimmed cells. Handles double-quoted cells (with ""
 * escapes) for CSV; quoting is also honoured for TSV, where it is harmless.
 * Fully-empty lines (and lines of only delimiters/whitespace) are dropped.
 */
export function parseDelimited(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      inQuotes = true;
      cell = ''; // discard any leading whitespace before the quote
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      pushRow();
      // Swallow a \r\n pair as one line break.
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  pushRow();
  return rows;
}

/** Recognised header spellings for each fixed sizing column. */
const HEADER_ALIASES: Record<Exclude<ImportTarget, `custom:${string}`>, string[]> = {
  size: ['size', 'sizes', 'garment size'],
  playerName: ['player', 'player name', 'playername', 'name', 'full name'],
  playerNumber: ['#', 'no', 'no.', 'num', 'number', 'player number', 'player #', 'jersey number', 'jersey #'],
  quantity: ['qty', 'quantity', 'count', 'pieces'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

function matchHeader(header: string, customLabels: string[]): ImportTarget | null {
  const norm = header.trim().toLowerCase();
  if (!norm) return null;
  const custom = customLabels.find((l) => l.trim().toLowerCase() === norm);
  if (custom) return `custom:${custom}`;
  for (const [target, aliases] of Object.entries(HEADER_ALIASES) as [ImportTarget, string[]][]) {
    if (aliases.includes(norm)) return target;
  }
  return null;
}

/**
 * Heuristic default for "first row is headers": true when at least one cell of
 * the first row matches a known header name or one of the garment's custom
 * column labels. The modal shows the guess as a checkbox staff can flip.
 */
export function looksLikeHeaderRow(row: string[] | undefined, customLabels: string[] = []): boolean {
  if (!row) return false;
  return row.some((cell) => matchHeader(cell, customLabels) !== null);
}

/** The sizing table's own column order — the no-headers positional default. */
function positionalTargets(columnCount: number, customLabels: string[]): (ImportTarget | null)[] {
  const order: (ImportTarget | null)[] = [
    'size',
    'playerName',
    'playerNumber',
    'quantity',
    ...customLabels.map((l): ImportTarget => `custom:${l}`),
    'notes',
  ];
  return Array.from({ length: columnCount }, (_, i) => order[i] ?? null);
}

/**
 * Default column→target mapping. With headers, each column maps by header
 * match (unmatched headers → ignore, so a stray "Paid?" column never lands in
 * Notes); duplicate matches keep the first and ignore the rest. Without
 * headers, columns map positionally in the table's own order: size, player,
 * number, qty, then the custom columns, then notes.
 */
export function guessColumnTargets(
  headers: string[] | null,
  columnCount: number,
  sizingColumns: Pick<GarmentTypeOption, 'label'>[] = [],
): (ImportTarget | null)[] {
  const customLabels = sizingColumns.map((c) => c.label);
  if (!headers) return positionalTargets(columnCount, customLabels);
  const used = new Set<ImportTarget>();
  return Array.from({ length: columnCount }, (_, i) => {
    const target = matchHeader(headers[i] ?? '', customLabels);
    if (!target || used.has(target)) return null;
    used.add(target);
    return target;
  });
}

/** Apply a column→target mapping to the data rows. Rows that end up entirely
 *  empty (every mapped cell blank) are dropped. */
export function buildImportedRows(
  dataRows: string[][],
  targets: (ImportTarget | null)[],
): ImportedSizingRow[] {
  const rows: ImportedSizingRow[] = [];
  for (const raw of dataRows) {
    const row: ImportedSizingRow = {
      size: '',
      playerName: '',
      playerNumber: '',
      quantity: '',
      notes: '',
      customValues: {},
    };
    let hasValue = false;
    targets.forEach((target, i) => {
      if (!target) return;
      const value = (raw[i] ?? '').trim();
      if (!value) return;
      hasValue = true;
      if (target.startsWith('custom:')) {
        row.customValues[target.slice('custom:'.length)] = value;
      } else {
        row[target as Exclude<ImportTarget, `custom:${string}`>] = value;
      }
    });
    if (hasValue) rows.push(row);
  }
  return rows;
}

/** Human labels for the mapping selects in the import modal. */
export function targetLabel(target: ImportTarget): string {
  if (target.startsWith('custom:')) return target.slice('custom:'.length);
  switch (target) {
    case 'size':
      return 'Size';
    case 'playerName':
      return 'Player Name';
    case 'playerNumber':
      return 'Number';
    case 'quantity':
      return 'Qty';
    case 'notes':
      return 'Notes';
    default:
      return target;
  }
}
