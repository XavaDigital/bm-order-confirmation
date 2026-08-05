/**
 * Pure helpers + shared types for the supplier-facing PO surfaces
 * (/supplier/[code], /supplier/[code]/po/[poNumber] and the legacy /s/[token] link).
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

/** One shared order note as the supplier surfaces receive it over JSON. */
export interface SupplierComment {
  id: string;
  body: string;
  authorKind: 'staff' | 'email_flow' | 'system' | 'supplier';
  authorLabel: string | null;
  createdAt: string;
}

/** One status change from SupplierPortalViewDto.statusHistory (JSON shape). */
export interface SupplierStatusChange {
  from: string;
  to: string;
  at: string;
  by: string | null;
}

/**
 * One entry of the merged activity feed (David, 2026-08-06: comments, file
 * uploads and status changes in ONE chronological stream). Generic over the
 * comment/file shapes so the helper stays free of component imports.
 */
export type ActivityEntry<C extends { createdAt: string }, F extends { createdAt: string }> =
  | { kind: 'status'; at: string; change: SupplierStatusChange }
  | { kind: 'file'; at: string; file: F }
  | { kind: 'comment'; at: string; comment: C };

/** Same-timestamp ordering: the status line that opened a stage reads before
 * the file uploaded in it, which reads before the comments on it. */
const ACTIVITY_KIND_RANK = { status: 0, file: 1, comment: 2 } as const;

/**
 * Merge comments, file uploads and status changes into one chronological
 * stream, oldest first (chat order — the composer sits at the bottom).
 * Unparseable timestamps sort to the start rather than throwing; ties break by
 * kind (status → file → comment), then original position (stable).
 */
export function buildActivityFeed<
  C extends { createdAt: string },
  F extends { createdAt: string },
>(input: {
  comments: readonly C[];
  files?: readonly F[] | null;
  statusChanges?: readonly SupplierStatusChange[] | null;
}): ActivityEntry<C, F>[] {
  const entries: ActivityEntry<C, F>[] = [
    ...(input.statusChanges ?? []).map((change) => ({
      kind: 'status' as const,
      at: change.at,
      change,
    })),
    ...(input.files ?? []).map((file) => ({ kind: 'file' as const, at: file.createdAt, file })),
    ...input.comments.map((comment) => ({
      kind: 'comment' as const,
      at: comment.createdAt,
      comment,
    })),
  ];
  return entries
    .map((entry, index) => {
      const parsed = Date.parse(entry.at);
      return { entry, index, time: Number.isNaN(parsed) ? 0 : parsed };
    })
    .sort(
      (a, b) =>
        a.time - b.time ||
        ACTIVITY_KIND_RANK[a.entry.kind] - ACTIVITY_KIND_RANK[b.entry.kind] ||
        a.index - b.index,
    )
    .map((ranked) => ranked.entry);
}

const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'];

/**
 * Whether an uploaded file can render as an inline thumbnail in the feed
 * (David, 2026-08-06: test prints show as images "so we can add comments
 * directly on it"). Extension-based — the files API stores no content type on
 * the DTO the supplier surface receives.
 */
export function isImageFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_FILE_EXTENSIONS.includes(fileName.slice(dot + 1).toLowerCase());
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
