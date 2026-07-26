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
 * Prefix a quote onto text that a spreadsheet app would otherwise evaluate as
 * a formula (leading =, +, -, @ or tab) — the well-known spreadsheet-injection
 * class. Customer input is always untrusted per this app's convention.
 *
 * Shared with the .xlsx exports (`src/server/purchase-orders/xlsx.ts`); the
 * risk is identical in a real workbook, not just in CSV.
 */
export function neutralizeFormula(value: string | number | null | undefined): string {
  if (value == null) return '';
  const raw = String(value);
  return /^[=+\-@\t]/.test(raw) ? `'${raw}` : raw;
}

/** CSV cell for customer-supplied text — formula-neutralized, then quoted. */
export function untrustedCsvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  return escapeCell(neutralizeFormula(value));
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.join(',')).join('\r\n');
}
