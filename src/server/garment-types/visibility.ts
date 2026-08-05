/**
 * Pure visibility resolution for chained conditional order options
 * (CHAINED_CONDITIONAL_FIELDS_PLAN.md). Shared verbatim between the server
 * (write-site enforcement, so a hidden child's stale value can never leak
 * into a PDF or PO) and the client (which options to render) — importing the
 * same function is what keeps the two from ever disagreeing about what
 * "visible" means.
 */
import type { GarmentTypeOption } from '@/db/schema';

/**
 * Labels of options currently visible, walking `orderOptions` top-down. An
 * option with no `showWhen` is always visible; one with a `showWhen` is
 * visible only if its parent is ALSO currently visible and the parent's
 * value in `selectedOptions` is one of `showWhen.equals` — a hidden parent
 * hides its children regardless of what value they'd otherwise match, which
 * is what makes this "chained" rather than single-level.
 */
export function visibleOptionLabels(
  orderOptions: GarmentTypeOption[],
  selectedOptions: Record<string, string>,
): Set<string> {
  const visible = new Set<string>();
  for (const opt of orderOptions) {
    if (!opt.showWhen) {
      visible.add(opt.label);
      continue;
    }
    const { parentLabel, equals } = opt.showWhen;
    if (visible.has(parentLabel) && equals.includes(selectedOptions[parentLabel] ?? '')) {
      visible.add(opt.label);
    }
  }
  return visible;
}

export function isOptionVisible(
  orderOptions: GarmentTypeOption[],
  label: string,
  selectedOptions: Record<string, string>,
): boolean {
  return visibleOptionLabels(orderOptions, selectedOptions).has(label);
}

/**
 * Drop any `selectedOptions` entry whose option is defined on the type but
 * not currently visible per the chain (parent missing, unchecked, or set to
 * a non-matching value). Keys with no matching option definition are left
 * untouched — this only prunes hidden CHILDREN, it is not a full allowlist
 * of every key.
 */
export function resolveVisibleOptions(
  orderOptions: GarmentTypeOption[],
  selectedOptions: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!selectedOptions) return selectedOptions ?? null;
  const visible = visibleOptionLabels(orderOptions, selectedOptions);
  const known = new Set(orderOptions.map((o) => o.label));
  const pruned: Record<string, string> = {};
  for (const [label, value] of Object.entries(selectedOptions)) {
    if (known.has(label) && !visible.has(label)) continue;
    pruned[label] = value;
  }
  return pruned;
}

/**
 * Default values for a type's options ({label: value}), pre-filled when
 * staff pick the type. Pruned through the same visibility filter so a
 * default never pre-fills a hidden child (e.g. "Numbers Front" defaulting in
 * even though "Numbers?" defaults to unchecked).
 */
export function typeOptionDefaults(orderOptions: GarmentTypeOption[]): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const opt of orderOptions) {
    if (opt.type === 'select' && opt.defaultOption) raw[opt.label] = opt.defaultOption;
    if (opt.type === 'text' && opt.defaultValue) raw[opt.label] = opt.defaultValue;
    if (opt.type === 'checkbox' && opt.defaultValue !== undefined) {
      raw[opt.label] = opt.defaultValue ? 'true' : 'false';
    }
  }
  return resolveVisibleOptions(orderOptions, raw) ?? {};
}

/**
 * Labels of REQUIRED options that are currently visible but unanswered
 * (David, 2026-08-06: "the sales person MUST choose a colour for the cord").
 * Hidden options are never missing — a `showWhen` chain that hides the cord
 * question means the cord needs no answer. Checkboxes carry no `required`
 * (unchecked is an answer), so only select/text participate.
 */
export function missingRequiredOptions(
  orderOptions: GarmentTypeOption[],
  selectedOptions: Record<string, string> | null | undefined,
): string[] {
  const selected = selectedOptions ?? {};
  const visible = visibleOptionLabels(orderOptions, selected);
  return orderOptions
    .filter(
      (opt) =>
        opt.type !== 'checkbox' &&
        opt.required === true &&
        visible.has(opt.label) &&
        !(selected[opt.label] ?? '').trim(),
    )
    .map((opt) => opt.label);
}
