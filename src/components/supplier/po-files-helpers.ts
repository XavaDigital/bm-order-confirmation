/**
 * Pure helpers for the production-files card on the supplier PO page
 * (David, 2026-08-05). Kept free of React/antd so the grouping and version
 * numbering are unit-testable.
 */

/** Free-text category, with these offered as suggestions (David's stages). */
export const PO_FILE_CATEGORY_SUGGESTIONS = ['Layout', 'Test print', 'Production layout'];

export interface PoFileGroup<T> {
  /** Stable render key — the category, or 'uncategorised'. */
  key: string;
  /** Heading the card shows. */
  label: string;
  /**
   * Oldest first, each stamped with its 1-based version WITHIN the category —
   * a later file in the same category IS the newer version of that stage's
   * work, which is exactly the progression record the card exists to show.
   */
  files: (T & { version: number })[];
}

/**
 * Group a PO's files by category for display. Input arrives oldest-first
 * (upload order — the server guarantees it); groups keep the order the
 * categories first appeared in, with uncategorised files always LAST.
 * Category matching is exact (categories are free text but suggested), so
 * "Layout" and "layout" are distinct groups rather than silently merged.
 */
export function groupPoFiles<T extends { category: string | null }>(items: T[]): PoFileGroup<T>[] {
  const groups = new Map<string, PoFileGroup<T>>();
  for (const item of items) {
    const key = item.category ?? 'uncategorised';
    let group = groups.get(key);
    if (!group) {
      group = { key, label: item.category ?? 'Other files', files: [] };
      groups.set(key, group);
    }
    group.files.push({ ...item, version: group.files.length + 1 });
  }
  const ordered = [...groups.values()];
  const uncategorised = groups.get('uncategorised');
  if (uncategorised) {
    ordered.splice(ordered.indexOf(uncategorised), 1);
    ordered.push(uncategorised);
  }
  return ordered;
}

/** "1.2 MB" / "830 KB" — null in, null out (size is nullable on old rows). */
export function formatFileSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
