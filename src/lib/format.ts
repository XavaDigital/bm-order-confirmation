/**
 * Shared date/currency display formatting. Centralizes the en-NZ locale
 * choice used across the admin tables and the customer confirmation page.
 */

const LOCALE = 'en-NZ';

/** e.g. "7 Jul 2026" */
export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** e.g. "7 July 2026" */
export function formatDateLong(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** e.g. "1,234.50" — amount only; callers render the currency code themselves. */
export function formatCurrency(amount: string | number): string {
  return Number(amount).toLocaleString(LOCALE, { minimumFractionDigits: 2 });
}
