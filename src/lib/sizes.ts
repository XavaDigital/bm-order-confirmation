/**
 * Chart-owned size helpers, shared by the admin sizing table and the customer
 * roster flow. Size lists live on size charts (size_charts.sizes); a garment's
 * allowed sizes are the union of its linked charts' lists.
 */
import type { SizeChartKind, SizeChartSize } from '@/db/schema';

/**
 * Filter a garment's `sizeChartLinks` down to CUSTOMER charts for the
 * customer-facing surfaces (order page, roster flows) — production charts
 * carry factory detail and must never reach a customer. Also drops dangling
 * link rows (null chart), like the inline `.filter((l) => l.sizeChart)` it
 * replaces. A chart without a loaded `kind` counts as customer — the column
 * defaults to 'customer', so absence only means an old caller didn't select it.
 */
export function customerChartLinks<
  C extends { kind?: SizeChartKind | null },
  L extends { sizeChart: C | null },
>(links: L[]): (L & { sizeChart: C })[] {
  return links.filter(
    (l): l is L & { sizeChart: C } =>
      l.sizeChart != null && (l.sizeChart.kind ?? 'customer') === 'customer',
  );
}

/**
 * Union the size lists of several charts, preserving chart order. Duplicate
 * labels (case-insensitive) keep the first occurrence; `tall` is OR-ed across
 * duplicates so any chart offering a tall variant makes it available.
 */
export function unionChartSizes(charts: { sizes: SizeChartSize[] }[]): SizeChartSize[] {
  const byLabel = new Map<string, SizeChartSize>();
  for (const chart of charts) {
    for (const size of chart.sizes ?? []) {
      const key = size.label.toLowerCase();
      const existing = byLabel.get(key);
      if (existing) {
        if (size.tall && !existing.tall) byLabel.set(key, { ...existing, tall: true });
      } else {
        byLabel.set(key, { label: size.label, tall: Boolean(size.tall) });
      }
    }
  }
  return [...byLabel.values()];
}

/** The stored value for a tall variant — verbatim in garment_sizing.size. */
export function tallLabel(label: string): string {
  return `${label} Tall`;
}

/**
 * Flat select options for a size list: each size, with its tall variant
 * (e.g. "L Tall") immediately after when enabled.
 */
export function buildSizeSelectOptions(
  sizes: SizeChartSize[],
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (const size of sizes) {
    options.push({ value: size.label, label: size.label });
    if (size.tall) {
      const tall = tallLabel(size.label);
      options.push({ value: tall, label: tall });
    }
  }
  return options;
}

/**
 * Like buildSizeSelectOptions, but appends the currently-saved value when it
 * is no longer in the list (chart edited after submission) so it still
 * displays instead of rendering as a broken selection.
 */
export function buildSizeSelectOptionsWithCurrent(
  sizes: SizeChartSize[],
  current?: string,
): { value: string; label: string }[] {
  const options = buildSizeSelectOptions(sizes);
  const trimmed = current?.trim();
  if (trimmed && !options.some((o) => o.value === trimmed)) {
    options.push({ value: trimmed, label: trimmed });
  }
  return options;
}
