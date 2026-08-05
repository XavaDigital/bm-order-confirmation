/**
 * Pure helpers + shared types for the supplier-facing PO surfaces
 * (/supplier/[code], /supplier/po/[poNumber] and the legacy /s/[token] link).
 *
 * Kept free of React/antd so they are unit-testable and so BOTH surfaces render
 * garments from the same column/row logic — the "MUST always be displayed"
 * rules (David, 2026-08-05: every sizing column and every garment option render
 * even when blank) live here once, not per view.
 */
import type {
  PoSnapshotAsset,
  PoSnapshotGarment,
  PoSnapshotImage,
  PoSnapshotLine,
  PoSnapshotSizeChart,
} from '@/db/schema';

// The snapshot stores storage KEYS only; the service signs URLs per request
// (signPoAssets / signPoSnapshotMedia). These are the post-signing shapes the
// views actually receive.
export type SignedPoImage = PoSnapshotImage & {
  url?: string | null;
  thumbnailUrl?: string | null;
};
export type SignedPoSizeChart = PoSnapshotSizeChart & { downloadUrl?: string | null };
export type SignedPoAsset = PoSnapshotAsset & { downloadUrl?: string | null };

/**
 * Every option entry of a garment, blank values INCLUDED (rendered as a dash
 * by the caller) — options must always be displayed, blank or not.
 */
export function optionEntries(
  map: Record<string, string> | null | undefined,
): { label: string; value: string }[] {
  if (!map) return [];
  return Object.entries(map).map(([label, value]) => ({
    label,
    value: (value ?? '').trim(),
  }));
}

/** One sizing-table column the supplier views render. */
export interface LineColumnDescriptor {
  key: string;
  label: string;
  getValue: (line: PoSnapshotLine) => string;
}

/**
 * The full ordered column set for a garment's sizing table: the fixed
 * Size/Player/Number/Qty columns, then EVERY custom sizing column captured in
 * the revision (headers render even when all values are blank), then Notes.
 */
export function lineColumnDescriptors(
  garment: Pick<PoSnapshotGarment, 'sizingColumns'>,
): LineColumnDescriptor[] {
  return [
    { key: 'size', label: 'Size', getValue: (l) => l.size ?? '' },
    { key: 'playerName', label: 'Player Name', getValue: (l) => l.playerName ?? '' },
    { key: 'playerNumber', label: 'Number', getValue: (l) => l.playerNumber ?? '' },
    // Pre-quantity revisions (before 0025) have no value — one each.
    { key: 'quantity', label: 'Qty', getValue: (l) => String(l.quantity ?? 1) },
    ...(garment.sizingColumns ?? []).map(
      (column): LineColumnDescriptor => ({
        key: `custom:${column.label}`,
        label: column.label,
        getValue: (l) => l.customValues?.[column.label] ?? '',
      }),
    ),
    { key: 'notes', label: 'Notes', getValue: (l) => l.notes ?? '' },
  ];
}

/** Total units in a garment, treating a missing quantity as 1. */
export function garmentUnits(garment: Pick<PoSnapshotGarment, 'lines'>): number {
  return garment.lines.reduce((sum, line) => sum + (line.quantity ?? 1), 0);
}

/**
 * Free-text search over the portal PO table — matches the PO number or any
 * garment name, case-insensitively. An empty query matches everything.
 */
export function matchesPoSearch(
  row: { poNumber: string; garmentNames: string[] },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.poNumber.toLowerCase().includes(q)) return true;
  return row.garmentNames.some((name) => name.toLowerCase().includes(q));
}

/**
 * Split a bulk status-change response into what the toolbar reports:
 * a success count and a per-PO failure list ("PO-2607-DY01: Not found").
 */
export function summarizeStatusResults(
  results: { poNumber: string; ok: boolean; error?: string }[],
): { okCount: number; failures: string[] } {
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => `${r.poNumber}: ${r.error ?? 'Update failed'}`);
  return { okCount: results.length - failures.length, failures };
}

/**
 * Statuses from which the supplier can no longer touch the ship date (David,
 * 2026-08-05: "can not affect anything after SHIPPED"). Mirrors the server's
 * locked_after_shipping guard so the UI hides the editor rather than offering
 * a save that 409s.
 */
export const SHIP_DATE_LOCKED_STATUSES = [
  'in_transit',
  'received',
  'completed',
  'remake',
  'cancelled',
] as const;

export function isShipDateLocked(status: string): boolean {
  return (SHIP_DATE_LOCKED_STATUSES as readonly string[]).includes(status);
}

/** "6 Aug, 14:32" — comment timestamps on the supplier surfaces. */
export function formatCommentWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
