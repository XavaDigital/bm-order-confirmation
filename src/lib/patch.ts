/**
 * Build a partial update object containing only the keys the caller actually
 * provided (dropping `undefined`, keeping explicit `null` = "clear this
 * field") — for PATCH semantics feeding a drizzle `.set()`.
 */
export function pickDefined<T extends Record<string, unknown>>(
  patch: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}
