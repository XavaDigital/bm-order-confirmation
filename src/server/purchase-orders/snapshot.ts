/**
 * Pure PO snapshot projections — build, summarize, diff, and coverage-map the
 * immutable revision snapshots (`PoSnapshot` in src/db/schema.ts).
 *
 * Keep this module free of I/O (no db, no storage) so it stays trivially
 * unit-testable — the service feeds it live rows, this file never fetches.
 *
 * Identity model: every snapshot line is keyed by `sizingRowId` — the
 * `garment_sizing` row UUID, which staff saves preserve (see upsertSizingRows).
 * Variance and coverage match by these ids ONLY, never by size-string
 * similarity: a row whose id is gone was deleted, full stop.
 */
import type {
  GarmentTypeOption,
  PoSnapshotAsset,
  PoSnapshotCheck,
  PoSnapshot,
  PoSnapshotGarment,
  PoSnapshotImage,
  PoSnapshotLine,
  PoSnapshotSizeChart,
} from '@/db/schema';

// ---------------------------------------------------------------------------
// Live-row input shapes (structural — drizzle query results satisfy them)
// ---------------------------------------------------------------------------

export interface LiveSizingRow {
  id: string;
  size: string | null;
  playerName: string | null;
  playerNumber: string | null;
  /** Defaults to 1 — see lineQuantity for why this is not simply required. */
  quantity?: number | null;
  notes: string | null;
  /** Values for the garment's user-defined sizing columns ({label: value}). */
  customValues?: Record<string, string> | null;
}

/**
 * A line's quantity, defaulting to 1.
 *
 * Every read of quantity goes through this. Revisions cut before quantity
 * existed have no such field, and a line back then meant exactly one garment —
 * so a missing value is 1, never 0. Getting that wrong would silently shrink
 * historical POs when their totals are recomputed.
 */
export function lineQuantity(line: { quantity?: number | null }): number {
  return line.quantity ?? 1;
}

export interface LiveGarment {
  id: string;
  name: string;
  /** Legacy jsonb — may be null/non-array on old rows; normalized to string[]. */
  fabrics: unknown;
  garmentTypeId?: string | null;
  garmentType?: { name: string } | null;
  selectedFabrics?: Record<string, string> | null;
  selectedOptions?: Record<string, string> | null;
  /** The garment's user-defined sizing-column definitions. */
  sizingColumns?: GarmentTypeOption[] | null;
  /** Linked reference charts, as drizzle's relation shape. Optional so pure
   *  callers that never loaded the relation keep working. */
  sizeChartLinks?: { sizeChart: { id: string; name: string; storageKey: string | null } | null }[];
  /** Mock-up images, as drizzle's relation shape (already sorted by the loader). */
  images?: { id: string; storageKey: string; thumbnailStorageKey: string | null; caption: string | null }[];
  notes: string | null;
  sizing: LiveSizingRow[];
}

/** Chart links → the snapshot shape, dropping any dangling link rows. */
function toSnapshotSizeCharts(g: LiveGarment): PoSnapshotSizeChart[] {
  return (g.sizeChartLinks ?? [])
    .map((link) => link.sizeChart)
    .filter((chart): chart is NonNullable<typeof chart> => chart !== null)
    .map((chart) => ({ id: chart.id, name: chart.name, storageKey: chart.storageKey ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Snapshot build
// ---------------------------------------------------------------------------

function toSnapshotLine(row: LiveSizingRow): PoSnapshotLine {
  return {
    sizingRowId: row.id,
    size: row.size ?? null,
    playerName: row.playerName ?? null,
    playerNumber: row.playerNumber ?? null,
    quantity: lineQuantity(row),
    notes: row.notes ?? null,
    customValues: row.customValues ?? null,
  };
}

function normalizeFabrics(fabrics: unknown): string[] {
  return Array.isArray(fabrics) ? (fabrics as string[]) : [];
}

/**
 * Project the selected live garments into the immutable revision snapshot.
 * Related to `toGarmentDto` (orders/mappers) but deliberately its own
 * projection: PO lines MUST carry the sizing-row id, and garments carry the
 * type id alongside the denormalized type name for the supplier PDF.
 */
export function buildPoSnapshot(
  order: {
    orderNumber: string;
    /** Set when this order is a reprint — the factory reuses the prior layout. */
    reprintOfOrderNumber?: string | null;
    /** Who cut this revision. */
    preparedByEmail?: string | null;
  },
  garments: LiveGarment[],
  /** Assets flagged includeOnPo, captured so a regenerated PDF still matches. */
  assets: PoSnapshotAsset[] = [],
  /** Order checks confirmed BEFORE this revision was cut — later confirmations
   *  belong to the next revision, which is what keeps the document honest. */
  checks: PoSnapshotCheck[] = [],
): PoSnapshot {
  return {
    orderNumber: order.orderNumber,
    reprintOfOrderNumber: order.reprintOfOrderNumber ?? null,
    preparedByEmail: order.preparedByEmail ?? null,
    checks,
    assets,
    garments: garments.map(
      (g): PoSnapshotGarment => ({
        garmentId: g.id,
        name: g.name,
        garmentTypeId: g.garmentTypeId ?? null,
        garmentTypeName: g.garmentType?.name ?? null,
        fabrics: normalizeFabrics(g.fabrics),
        selectedFabrics: g.selectedFabrics ?? null,
        selectedOptions: g.selectedOptions ?? null,
        sizingColumns: g.sizingColumns ?? [],
        sizeCharts: toSnapshotSizeCharts(g),
        images: (g.images ?? []).map(
          (img): PoSnapshotImage => ({
            id: img.id,
            storageKey: img.storageKey,
            thumbnailStorageKey: img.thumbnailStorageKey ?? null,
            caption: img.caption ?? null,
          }),
        ),
        notes: g.notes ?? null,
        lines: g.sizing.map(toSnapshotLine),
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Size summary
// ---------------------------------------------------------------------------

/** Bucket label for lines with no size picked yet. */
export const NO_SIZE_LABEL = '(no size)';

export interface PoSizeSummary {
  perGarment: Array<{
    garmentId: string;
    name: string;
    counts: Record<string, number>;
    total: number;
  }>;
  grandTotal: number;
}

/**
 * Counts by size label per garment (null/blank sizes bucket as '(no size)').
 *
 * Sums QUANTITY, not rows — this is what the factory cuts to, so a line
 * reading "Medium x 20" has to count as twenty garments, not one.
 */
export function sizeSummary(snapshot: PoSnapshot): PoSizeSummary {
  let grandTotal = 0;
  const perGarment = snapshot.garments.map((g) => {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const line of g.lines) {
      const label = line.size?.trim() ? line.size : NO_SIZE_LABEL;
      const qty = lineQuantity(line);
      counts[label] = (counts[label] ?? 0) + qty;
      total += qty;
    }
    grandTotal += total;
    return { garmentId: g.garmentId, name: g.name, counts, total };
  });
  return { perGarment, grandTotal };
}

// ---------------------------------------------------------------------------
// Variance (live order vs. a revision snapshot)
// ---------------------------------------------------------------------------

export interface PoFieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface PoVarianceLine {
  sizingRowId: string;
  change: 'added' | 'removed' | 'modified';
  /** Only for 'modified'. */
  fieldChanges?: PoFieldChange[];
  /** The live row ('added'/'modified') or the snapshot line ('removed') — for display. */
  line: PoSnapshotLine;
}

export interface PoVarianceGarment {
  garmentId: string;
  name: string;
  status: 'removed' | 'modified' | 'unchanged';
  /** Garment-level field diffs (empty for 'removed'/'unchanged'). */
  fieldChanges: PoFieldChange[];
  /** Line-level diffs (empty for 'removed'/'unchanged'). */
  lines: PoVarianceLine[];
}

export interface PoVarianceAsset {
  change: 'added' | 'removed' | 'modified';
  /** Identity for display — assets have no stable id in the snapshot. */
  name: string;
  garmentName: string | null;
  /** Only for 'modified'. */
  fieldChanges?: PoFieldChange[];
}

export interface PoVariance {
  garments: PoVarianceGarment[];
  /**
   * Design and font files that changed since the revision was cut. Without
   * this, swapping the font on an order left the sent PO silently stale: the
   * factory kept working from the old file and nothing on screen said so.
   */
  assets: PoVarianceAsset[];
  hasVariance: boolean;
}

/** Order-insensitive structural equality for jsonb-ish values (arrays compared in order). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fields whose change makes a line count as variance.
 *
 * `quantity` MUST be here. Leaving a per-line field out means edits to it
 * never register as PO variance, so the supplier keeps working from a revision
 * that no longer matches the order and nothing says so.
 */
const LINE_FIELDS = ['size', 'playerName', 'playerNumber', 'quantity', 'notes'] as const;

/** Per-column diff of two customValues maps, as individual field changes. */
function customValueChanges(
  from: Record<string, string> | null | undefined,
  to: Record<string, string> | null | undefined,
): PoFieldChange[] {
  const a = from ?? {};
  const b = to ?? {};
  const labels = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: PoFieldChange[] = [];
  for (const label of labels) {
    const before = a[label] ?? null;
    const after = b[label] ?? null;
    // Report the column by name so the variance UI reads "Colour: Navy → Red".
    if (before !== after) changes.push({ field: label, from: before, to: after });
  }
  return changes;
}

/**
 * Compare LIVE garment rows against a revision snapshot, matched by ids only.
 *
 * Scope is the SNAPSHOT's garments: a garment added to the order after the
 * snapshot is a coverage gap (see computeCoverage), not variance. Per
 * snapshotted garment:
 *  - 'removed'   — the garment id is no longer on the order;
 *  - 'modified'  — garment-level fields changed and/or any line was
 *                  added/removed/modified (by sizingRowId);
 *  - 'unchanged' — nothing differs.
 */
export function detectVariance(
  currentGarments: LiveGarment[],
  snapshot: PoSnapshot,
  /**
   * Live assets flagged includeOnPo, in the same shape the snapshot stores.
   * Omitted by callers that only care about garments; asset variance is then
   * reported as empty rather than guessed at.
   */
  currentAssets?: PoSnapshotAsset[],
): PoVariance {
  const liveById = new Map(currentGarments.map((g) => [g.id, g]));

  const garments = snapshot.garments.map((snap): PoVarianceGarment => {
    const live = liveById.get(snap.garmentId);
    if (!live) {
      return { garmentId: snap.garmentId, name: snap.name, status: 'removed', fieldChanges: [], lines: [] };
    }

    const fieldChanges: PoFieldChange[] = [];
    const compareField = (field: string, from: unknown, to: unknown) => {
      if (!jsonEqual(from, to)) fieldChanges.push({ field, from, to });
    };
    compareField('name', snap.name, live.name);
    compareField('fabrics', snap.fabrics, normalizeFabrics(live.fabrics));
    compareField('selectedFabrics', snap.selectedFabrics, live.selectedFabrics ?? null);
    compareField('selectedOptions', snap.selectedOptions, live.selectedOptions ?? null);
    compareField('notes', snap.notes, live.notes ?? null);

    /**
     * Chart LINKAGE is variance — the factory cuts to these. Skipped entirely
     * for snapshots that predate chart capture (`sizeCharts` undefined): what
     * they were linked to back then is unknowable, and comparing against [] would
     * flag every pre-existing PO the first time someone opened it. Compared by
     * id but REPORTED by name, so renaming a chart in the library neither flags
     * every sent PO nor shows uuids in the variance panel.
     */
    if (snap.sizeCharts !== undefined) {
      const snapIds = snap.sizeCharts.map((c) => c.id).sort();
      const liveCharts = toSnapshotSizeCharts(live);
      if (!jsonEqual(snapIds, liveCharts.map((c) => c.id).sort())) {
        fieldChanges.push({
          field: 'sizeCharts',
          from: snap.sizeCharts.map((c) => c.name),
          to: liveCharts.map((c) => c.name),
        });
      }
    }

    const lines: PoVarianceLine[] = [];
    const snapLineById = new Map(snap.lines.map((l) => [l.sizingRowId, l]));
    const liveRowById = new Map(live.sizing.map((r) => [r.id, r]));

    for (const snapLine of snap.lines) {
      const liveRow = liveRowById.get(snapLine.sizingRowId);
      if (!liveRow) {
        lines.push({ sizingRowId: snapLine.sizingRowId, change: 'removed', line: snapLine });
        continue;
      }
      const lineChanges: PoFieldChange[] = [];
      for (const field of LINE_FIELDS) {
        // Quantity is defaulted on BOTH sides before comparing. A revision cut
        // before the column existed has no quantity, and a live row of 1 means
        // the same thing — comparing raw would report a change on every
        // pre-existing PO the first time anyone looked at it.
        const from = field === 'quantity' ? lineQuantity(snapLine) : (snapLine[field] ?? null);
        const to = field === 'quantity' ? lineQuantity(liveRow) : (liveRow[field] ?? null);
        if (from !== to) lineChanges.push({ field, from, to });
      }
      lineChanges.push(...customValueChanges(snapLine.customValues, liveRow.customValues));
      if (lineChanges.length > 0) {
        lines.push({
          sizingRowId: snapLine.sizingRowId,
          change: 'modified',
          fieldChanges: lineChanges,
          line: toSnapshotLine(liveRow),
        });
      }
    }
    for (const liveRow of live.sizing) {
      if (!snapLineById.has(liveRow.id)) {
        lines.push({ sizingRowId: liveRow.id, change: 'added', line: toSnapshotLine(liveRow) });
      }
    }

    return {
      garmentId: snap.garmentId,
      name: snap.name,
      status: fieldChanges.length > 0 || lines.length > 0 ? 'modified' : 'unchanged',
      fieldChanges,
      lines,
    };
  });

  const assets = currentAssets ? detectAssetVariance(snapshot.assets ?? [], currentAssets) : [];

  return {
    garments,
    assets,
    hasVariance: garments.some((g) => g.status !== 'unchanged') || assets.length > 0,
  };
}

/** Assets carry no id in the snapshot, so identity is (garmentName, name). */
function assetKey(a: PoSnapshotAsset): string {
  return `${a.garmentName ?? ''} ${a.name}`;
}

const ASSET_FIELDS = ['kind', 'usage', 'url', 'storageKey', 'notes'] as const;

function detectAssetVariance(
  snapAssets: PoSnapshotAsset[],
  liveAssets: PoSnapshotAsset[],
): PoVarianceAsset[] {
  const snapByKey = new Map(snapAssets.map((a) => [assetKey(a), a]));
  const liveByKey = new Map(liveAssets.map((a) => [assetKey(a), a]));
  const out: PoVarianceAsset[] = [];

  for (const snap of snapAssets) {
    const live = liveByKey.get(assetKey(snap));
    if (!live) {
      out.push({ change: 'removed', name: snap.name, garmentName: snap.garmentName });
      continue;
    }
    const fieldChanges: PoFieldChange[] = [];
    for (const field of ASSET_FIELDS) {
      const from = snap[field] ?? null;
      const to = live[field] ?? null;
      if (from !== to) fieldChanges.push({ field, from, to });
    }
    if (fieldChanges.length > 0) {
      out.push({ change: 'modified', name: snap.name, garmentName: snap.garmentName, fieldChanges });
    }
  }
  for (const live of liveAssets) {
    if (!snapByKey.has(assetKey(live))) {
      out.push({ change: 'added', name: live.name, garmentName: live.garmentName });
    }
  }
  return out;
}

export interface PoVarianceCounts {
  added: number;
  modified: number;
  removed: number;
}

/**
 * Counts for the variance banner: line-level changes plus garment-level ones
 * (a removed garment counts once under `removed`; a garment with field
 * changes counts once under `modified`, on top of its line diffs).
 */
export function varianceCounts(v: PoVariance): PoVarianceCounts {
  const counts: PoVarianceCounts = { added: 0, modified: 0, removed: 0 };
  for (const g of v.garments) {
    if (g.status === 'removed') {
      counts.removed += 1;
      continue;
    }
    if (g.fieldChanges.length > 0) counts.modified += 1;
    for (const line of g.lines) counts[line.change] += 1;
  }
  // A changed font is as much a reason to re-cut a revision as a changed size,
  // so it has to reach the banner's numbers too.
  for (const asset of v.assets ?? []) counts[asset.change] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Coverage (which sizing rows are on a live PO)
// ---------------------------------------------------------------------------

export interface PoCoverage {
  totalRows: number;
  coveredRows: number;
  /** 0–100, rounded. 0 when the order has no sizing rows at all. */
  percentage: number;
  /** For each COVERED row id, the non-cancelled POs whose latest revision includes it. */
  rowToPos: Record<string, Array<{ poId: string; poNumber: string }>>;
  /** Uncovered-row count per garment — only garments with at least one uncovered row appear. */
  uncoveredByGarment: Record<string, number>;
}

/**
 * A sizing row is covered when its id appears in the LATEST revision snapshot
 * of any non-cancelled PO. Older revisions don't count (the supplier works
 * from the latest), and cancelled POs don't count at all.
 */
export function computeCoverage(
  allSizingRows: Array<{ id: string; garmentId: string }>,
  activePos: Array<{ poId: string; poNumber: string; status: string; latestSnapshot: PoSnapshot }>,
): PoCoverage {
  const rowToPos: Record<string, Array<{ poId: string; poNumber: string }>> = {};
  const knownRowIds = new Set(allSizingRows.map((r) => r.id));

  for (const po of activePos) {
    if (po.status === 'cancelled') continue;
    for (const garment of po.latestSnapshot.garments) {
      for (const line of garment.lines) {
        if (!knownRowIds.has(line.sizingRowId)) continue; // row deleted since snapshot
        (rowToPos[line.sizingRowId] ??= []).push({ poId: po.poId, poNumber: po.poNumber });
      }
    }
  }

  const uncoveredByGarment: Record<string, number> = {};
  let coveredRows = 0;
  for (const row of allSizingRows) {
    if (rowToPos[row.id]) {
      coveredRows += 1;
    } else {
      uncoveredByGarment[row.garmentId] = (uncoveredByGarment[row.garmentId] ?? 0) + 1;
    }
  }

  const totalRows = allSizingRows.length;
  return {
    totalRows,
    coveredRows,
    percentage: totalRows === 0 ? 0 : Math.round((coveredRows / totalRows) * 100),
    rowToPos,
    uncoveredByGarment,
  };
}
