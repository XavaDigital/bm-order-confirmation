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

/** e.g. "7/07/2026, 2:30 pm" — the standard date+time rendering. */
export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** e.g. "Tuesday, 7 July 2026, 2:30 pm" — for confirmation/ceremonial moments. */
export function formatDateTimeLong(value: string | number | Date): string {
  return new Date(value).toLocaleString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** e.g. "1,234.50" — amount only; callers render the currency code themselves. */
export function formatCurrency(amount: string | number): string {
  return Number(amount).toLocaleString(LOCALE, { minimumFractionDigits: 2 });
}
