/**
 * Minimal CSV serialization for admin exports (RFC 4180 quoting only —
 * hand-rolled rather than a dependency since that's the entire correctness
 * surface this app needs). See FEATURE_PROPOSALS.md #3.
 */

function escapeCell(raw: string): string {
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** Plain CSV cell — use for server-controlled values (enums, dates, IDs, amounts). */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  return escapeCell(String(value));
}

/**
 * CSV cell for customer-supplied text. Neutralizes a leading =, +, -, @, or
 * tab so spreadsheet apps don't evaluate it as a formula when the file is
 * opened (a well-known CSV-injection class) — customer input is always
 * untrusted per this app's convention.
 */
export function untrustedCsvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const raw = String(value);
  return escapeCell(/^[=+\-@\t]/.test(raw) ? `'${raw}` : raw);
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.join(',')).join('\r\n');
}
