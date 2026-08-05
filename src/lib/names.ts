/**
 * Player-name casing (David, 2026-08-05): a per-order choice made WITH the
 * customer. `orders.namesUppercase` on → names are uppercased AT WRITE in
 * every writer (roster page, per-member links, CSV import, admin sizing and
 * name lists) so what is saved IS what prints. Off → names print exactly as
 * entered, and the roster page says so.
 *
 * One helper so no writer invents its own rule. Locale-independent uppercase
 * (JS default) — names cross languages and the printer has no locale either.
 */
export function applyNameCase<T extends string | null | undefined>(
  uppercase: boolean,
  value: T,
): T | string {
  if (!uppercase || value == null) return value;
  return value.toUpperCase();
}
