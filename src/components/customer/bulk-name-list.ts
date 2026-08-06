/**
 * Client-side CSV parsing for the customer "Got Your Back" name-list bulk
 * upload (David: customers should be able to bulk-upload their order sheet,
 * with guidance on the structure).
 *
 * Deliberately CLIENT-side: the only customer-facing bulk write is the
 * existing name-list upsert route (max 300 entries), so the sheet is parsed
 * in the browser and submitted through that route — no new server surface.
 * CSV only; the server-side roster importer's exceljs is too heavy to ship to
 * the customer bundle, so the guidance says "save your sheet as CSV".
 *
 * Header hints mirror src/server/roster/import.ts (guessColumnMapping) so the
 * two importers accept the same column names.
 */
import Papa from 'papaparse';
import type { RosterNameListEntry } from '@/types/customer';

export const MAX_NAME_LIST_ENTRIES = 300;
export const MAX_BULK_FILE_BYTES = 1024 * 1024; // 1MB — a name list, not a database dump

export const NAME_LIST_TEMPLATE_HEADERS = ['Name', 'Number'] as const;

export class BulkNameListError extends Error {}

const NAME_HINTS = /name/i;
const NAME_EXCLUDE_HINTS = /club|team|school|company|file/i;
const NUMBER_HINTS = /number|jersey|^#$|^no\.?$|^num$/i;

/** The downloadable template — the exact headers the parser looks for. */
export function buildNameListTemplateCsv(): string {
  return `${NAME_LIST_TEMPLATE_HEADERS.join(',')}\r\n`;
}

export interface ParsedNameRow {
  name: string;
  playerNumber: string | null;
}

export interface BulkNameListParseResult {
  rows: ParsedNameRow[];
  /** Data rows skipped because the name cell was blank. */
  skippedBlank: number;
}

/**
 * Parse pasted/uploaded CSV text into name rows. Throws BulkNameListError
 * with a customer-readable message when the file is unusable — every message
 * should tell them how to fix the sheet, not what the code did.
 */
export function parseNameListCsv(text: string): BulkNameListParseResult {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rawRows = (parsed.data ?? []).map((row) => row.map((cell) => String(cell ?? '').trim()));
  const rows = rawRows.filter((row) => row.some((cell) => cell !== ''));
  if (rows.length === 0) {
    throw new BulkNameListError('The file is empty — add a header row and your names.');
  }

  const [headers, ...dataRows] = rows;
  const nameColumn = headers.findIndex(
    (h) => NAME_HINTS.test(h) && !NAME_EXCLUDE_HINTS.test(h),
  );
  if (nameColumn === -1) {
    throw new BulkNameListError(
      'No "Name" column found. The first row must be headers — use the template, or add a column called "Name".',
    );
  }
  const numberColumn = headers.findIndex((h) => NUMBER_HINTS.test(h));

  if (dataRows.length === 0) {
    throw new BulkNameListError('The file has headers but no names — add your names under the header row.');
  }
  if (dataRows.length > MAX_NAME_LIST_ENTRIES) {
    throw new BulkNameListError(
      `This file has ${dataRows.length} rows — the limit is ${MAX_NAME_LIST_ENTRIES} names.`,
    );
  }

  let skippedBlank = 0;
  const result: ParsedNameRow[] = [];
  for (const row of dataRows) {
    const name = (row[nameColumn] ?? '').trim();
    if (!name) {
      skippedBlank += 1;
      continue;
    }
    const playerNumber = numberColumn === -1 ? '' : (row[numberColumn] ?? '').trim();
    result.push({ name: name.slice(0, 200), playerNumber: playerNumber.slice(0, 20) || null });
  }
  if (result.length === 0) {
    throw new BulkNameListError('Every row had a blank name — check the "Name" column is filled in.');
  }
  return { rows: result, skippedBlank };
}

export interface MergeResult {
  entries: RosterNameListEntry[];
  added: number;
  /** Parsed rows dropped because the same name (+ number) is already listed. */
  duplicates: number;
}

const dedupeKey = (name: string, playerNumber: string | null) =>
  `${name.trim().toLowerCase()}\u0000${(playerNumber ?? '').trim()}`;

/**
 * Append parsed rows to the current draft, skipping rows already on the list
 * (case-insensitive name + number — re-uploading the same sheet is a no-op).
 * Throws when the merged list would exceed the server's 300-entry cap.
 */
export function mergeNameListEntries(
  existing: RosterNameListEntry[],
  parsed: ParsedNameRow[],
): MergeResult {
  const seen = new Set(
    existing.filter((e) => e.name.trim()).map((e) => dedupeKey(e.name, e.playerNumber)),
  );
  const additions: RosterNameListEntry[] = [];
  let duplicates = 0;
  for (const row of parsed) {
    const key = dedupeKey(row.name, row.playerNumber);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    // id '' = a new row — the save call strips empty ids so the server inserts.
    additions.push({ id: '', name: row.name, playerNumber: row.playerNumber });
  }

  const entries = [...existing, ...additions];
  const nonBlank = entries.filter((e) => e.name.trim()).length;
  if (nonBlank > MAX_NAME_LIST_ENTRIES) {
    throw new BulkNameListError(
      `That would put ${nonBlank} names on the list — the limit is ${MAX_NAME_LIST_ENTRIES}.`,
    );
  }
  return { entries, added: additions.length, duplicates };
}
