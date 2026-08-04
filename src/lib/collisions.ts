/**
 * Numbers (trimmed) used by 2+ entries. Blank/null entries never collide with
 * each other. A duplicate is a WARNING signal, never a save-blocker — a player
 * legitimately ordering two shirts in their own number is a duplicate too.
 */
export function findDuplicateNumbers(numbers: (string | null | undefined)[]): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of numbers) {
    const key = raw?.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}
