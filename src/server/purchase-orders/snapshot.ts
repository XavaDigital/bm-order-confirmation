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
import type { GarmentTypeOption, PoSnapshotAsset, PoSnapshot, PoSnapshotGarment, PoSnapshotLine } from '@/db/schema';

// ---------------------------------------------------------------------------
// Live-row input shapes (structural — drizzle query results satisfy them)
// ---------------------------------------------------------------------------

export interface LiveSizingRow {
  id: string;
  size: string | null;
  playerName: string | null;
  playerNumber: string | null;
  notes: string | null;
  /** Values for the garment's user-defined sizing columns ({label: value}). */
  customValues?: Record<string, string> | null;
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
  notes: string | null;
  sizing: LiveSizingRow[];
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
  },
  garments: LiveGarment[],
  /** Assets flagged includeOnPo, captured so a regenerated PDF still matches. */
  assets: PoSnapshotAsset[] = [],
): PoSnapshot {
  return {
    orderNumber: order.orderNumber,
    reprintOfOrderNumber: order.reprintOfOrderNumber ?? null,
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

/** Counts by size label per garment (null/blank sizes bucket as '(no size)'). */
export function sizeSummary(snapshot: PoSnapshot): PoSizeSummary {
  let grandTotal = 0;
  const perGarment = snapshot.garments.map((g) => {
    const counts: Record<string, number> = {};
    for (const line of g.lines) {
      const label = line.size?.trim() ? line.size : NO_SIZE_LABEL;
      counts[label] = (counts[label] ?? 0) + 1;
    }
    grandTotal += g.lines.length;
    return { garmentId: g.garmentId, name: g.name, counts, total: g.lines.length };
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

export interface PoVariance {
  garments: PoVarianceGarment[];
  hasVariance: boolean;
}

/** Order-insensitive structural equality for jsonb-ish values (arrays compared in order). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return JSON.stringify(a) === JSON.stringify(b);
}

const LINE_FIELDS = ['size', 'playerName', 'playerNumber', 'notes'] as const;

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
export function detectVariance(currentGarments: LiveGarment[], snapshot: PoSnapshot): PoVariance {
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
        const from = snapLine[field] ?? null;
        const to = liveRow[field] ?? null;
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

  return { garments, hasVariance: garments.some((g) => g.status !== 'unchanged') };
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
