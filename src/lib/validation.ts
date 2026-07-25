/** Shared Zod refinement predicates. */

/**
 * True when `key(item)` is unique across the array — for `.refine(...)` on
 * array schemas (option labels, size labels, …).
 */
export const uniqueBy =
  <T>(key: (item: T) => string) =>
  (items: readonly T[]): boolean =>
    new Set(items.map(key)).size === items.length;
