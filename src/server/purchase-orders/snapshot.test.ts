import { describe, expect, it } from 'vitest';
import type { PoSnapshot } from '@/db/schema';
import {
  NO_SIZE_LABEL,
  buildPoSnapshot,
  computeCoverage,
  detectVariance,
  sizeSummary,
  varianceCounts,
  type LiveGarment,
} from './snapshot';

function liveGarment(overrides: Partial<LiveGarment> = {}): LiveGarment {
  return {
    id: 'g-1',
    name: 'Team Hoodie',
    fabrics: ['Cotton Fleece'],
    garmentTypeId: 'type-1',
    garmentType: { name: 'Pullover Hoodie' },
    selectedFabrics: { 'Outer Fabric': 'Cotton Fleece' },
    selectedOptions: { 'Zip Type': 'pullover' },
    notes: 'front print',
    sizing: [
      { id: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '7', notes: null },
      { id: 'row-2', size: 'L', playerName: 'Bob', playerNumber: '8', notes: 'long sleeve' },
    ],
    ...overrides,
  };
}

describe('buildPoSnapshot', () => {
  it('projects garments and keys every line by the sizing-row id', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-AB12CD34' }, [liveGarment()]);

    expect(snapshot).toEqual({
      orderNumber: 'OC-AB12CD34',
      garments: [
        {
          garmentId: 'g-1',
          name: 'Team Hoodie',
          garmentTypeId: 'type-1',
          garmentTypeName: 'Pullover Hoodie',
          fabrics: ['Cotton Fleece'],
          selectedFabrics: { 'Outer Fabric': 'Cotton Fleece' },
          selectedOptions: { 'Zip Type': 'pullover' },
          notes: 'front print',
          lines: [
            { sizingRowId: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '7', notes: null },
            { sizingRowId: 'row-2', size: 'L', playerName: 'Bob', playerNumber: '8', notes: 'long sleeve' },
          ],
        },
      ],
    });
  });

  it('normalizes non-array fabrics and missing type/options to nulls and []', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        fabrics: null,
        garmentTypeId: null,
        garmentType: null,
        selectedFabrics: null,
        selectedOptions: undefined,
        notes: null,
        sizing: [],
      }),
    ]);

    expect(snapshot.garments[0]).toMatchObject({
      fabrics: [],
      garmentTypeId: null,
      garmentTypeName: null,
      selectedFabrics: null,
      selectedOptions: null,
      notes: null,
      lines: [],
    });
  });
});

describe('sizeSummary', () => {
  it('counts by size label per garment, bucketing null/blank sizes as (no size)', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        id: 'g-1',
        sizing: [
          { id: 'r1', size: 'M', playerName: null, playerNumber: null, notes: null },
          { id: 'r2', size: 'M', playerName: null, playerNumber: null, notes: null },
          { id: 'r3', size: 'L', playerName: null, playerNumber: null, notes: null },
          { id: 'r4', size: null, playerName: null, playerNumber: null, notes: null },
          { id: 'r5', size: '  ', playerName: null, playerNumber: null, notes: null },
        ],
      }),
      liveGarment({
        id: 'g-2',
        name: 'Shorts',
        sizing: [{ id: 'r6', size: 'S', playerName: null, playerNumber: null, notes: null }],
      }),
    ]);

    const summary = sizeSummary(snapshot);
    expect(summary.perGarment).toEqual([
      {
        garmentId: 'g-1',
        name: 'Team Hoodie',
        counts: { M: 2, L: 1, [NO_SIZE_LABEL]: 2 },
        total: 5,
      },
      { garmentId: 'g-2', name: 'Shorts', counts: { S: 1 }, total: 1 },
    ]);
    expect(summary.grandTotal).toBe(6);
  });
});

describe('detectVariance', () => {
  const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [liveGarment()]);

  it('reports unchanged when the live rows match the snapshot', () => {
    const v = detectVariance([liveGarment()], snapshot);
    expect(v.hasVariance).toBe(false);
    expect(v.garments).toEqual([
      expect.objectContaining({ garmentId: 'g-1', status: 'unchanged', fieldChanges: [], lines: [] }),
    ]);
    expect(varianceCounts(v)).toEqual({ added: 0, modified: 0, removed: 0 });
  });

  it('reports a modified line with its field changes', () => {
    const live = liveGarment();
    live.sizing[0] = { ...live.sizing[0], size: 'XL', playerName: 'Alicia' };

    const v = detectVariance([live], snapshot);
    expect(v.hasVariance).toBe(true);
    expect(v.garments[0].status).toBe('modified');
    expect(v.garments[0].lines).toEqual([
      {
        sizingRowId: 'row-1',
        change: 'modified',
        fieldChanges: [
          { field: 'size', from: 'M', to: 'XL' },
          { field: 'playerName', from: 'Alice', to: 'Alicia' },
        ],
        line: expect.objectContaining({ sizingRowId: 'row-1', size: 'XL' }),
      },
    ]);
    expect(varianceCounts(v)).toEqual({ added: 0, modified: 1, removed: 0 });
  });

  it('reports added and removed lines by id', () => {
    const live = liveGarment({
      sizing: [
        // row-1 kept, row-2 gone, row-3 new
        { id: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '7', notes: null },
        { id: 'row-3', size: 'S', playerName: 'Cara', playerNumber: '9', notes: null },
      ],
    });

    const v = detectVariance([live], snapshot);
    const changes = Object.fromEntries(v.garments[0].lines.map((l) => [l.sizingRowId, l.change]));
    expect(changes).toEqual({ 'row-2': 'removed', 'row-3': 'added' });
    expect(varianceCounts(v)).toEqual({ added: 1, modified: 0, removed: 1 });
  });

  it('reports a garment no longer on the order as removed', () => {
    const v = detectVariance([], snapshot);
    expect(v.garments).toEqual([
      { garmentId: 'g-1', name: 'Team Hoodie', status: 'removed', fieldChanges: [], lines: [] },
    ]);
    expect(varianceCounts(v)).toEqual({ added: 0, modified: 0, removed: 1 });
  });

  it('reports garment-level field changes (fabrics + selectedOptions)', () => {
    const live = liveGarment({
      fabrics: ['Poly Fleece'],
      selectedOptions: { 'Zip Type': 'full-zip' },
    });

    const v = detectVariance([live], snapshot);
    expect(v.garments[0].status).toBe('modified');
    expect(v.garments[0].fieldChanges).toEqual([
      { field: 'fabrics', from: ['Cotton Fleece'], to: ['Poly Fleece'] },
      {
        field: 'selectedOptions',
        from: { 'Zip Type': 'pullover' },
        to: { 'Zip Type': 'full-zip' },
      },
    ]);
    // Garment-level modification counts once; no line diffs.
    expect(varianceCounts(v)).toEqual({ added: 0, modified: 1, removed: 0 });
  });

  it('ignores garments added to the order after the snapshot (coverage gap, not variance)', () => {
    const newGarment = liveGarment({
      id: 'g-99',
      name: 'New Jacket',
      sizing: [{ id: 'row-99', size: 'M', playerName: null, playerNumber: null, notes: null }],
    });

    const v = detectVariance([liveGarment(), newGarment], snapshot);
    expect(v.hasVariance).toBe(false);
    expect(v.garments.map((g) => g.garmentId)).toEqual(['g-1']);
  });
});

describe('computeCoverage', () => {
  const rows = [
    { id: 'row-1', garmentId: 'g-1' },
    { id: 'row-2', garmentId: 'g-1' },
    { id: 'row-3', garmentId: 'g-2' },
  ];

  function snapshotWithRows(rowIds: string[], garmentId = 'g-1'): PoSnapshot {
    return {
      orderNumber: 'OC-1',
      garments: [
        {
          garmentId,
          name: 'Garment',
          garmentTypeId: null,
          garmentTypeName: null,
          fabrics: [],
          selectedFabrics: null,
          selectedOptions: null,
          notes: null,
          lines: rowIds.map((id) => ({
            sizingRowId: id,
            size: 'M',
            playerName: null,
            playerNumber: null,
            notes: null,
          })),
        },
      ],
    };
  }

  it('covers rows present in the latest revision of non-cancelled POs', () => {
    const coverage = computeCoverage(rows, [
      { poId: 'po-1', poNumber: 'PO-2607-VA01-X', status: 'sent', latestSnapshot: snapshotWithRows(['row-1', 'row-2']) },
    ]);

    expect(coverage.totalRows).toBe(3);
    expect(coverage.coveredRows).toBe(2);
    expect(coverage.percentage).toBe(67);
    expect(coverage.rowToPos['row-1']).toEqual([{ poId: 'po-1', poNumber: 'PO-2607-VA01-X' }]);
    expect(coverage.rowToPos['row-3']).toBeUndefined();
    expect(coverage.uncoveredByGarment).toEqual({ 'g-2': 1 });
  });

  it('excludes cancelled POs entirely', () => {
    const coverage = computeCoverage(rows, [
      { poId: 'po-1', poNumber: 'PO-1', status: 'cancelled', latestSnapshot: snapshotWithRows(['row-1', 'row-2']) },
    ]);
    expect(coverage.coveredRows).toBe(0);
    expect(coverage.rowToPos).toEqual({});
    expect(coverage.uncoveredByGarment).toEqual({ 'g-1': 2, 'g-2': 1 });
  });

  it('only the latest revision counts — a row dropped by a revision is uncovered', () => {
    // Rev 1 had row-1 + row-2; the (latest) rev 2 dropped row-2. Only the
    // latest snapshot is passed in, so row-2 must be uncovered.
    const coverage = computeCoverage(rows, [
      { poId: 'po-1', poNumber: 'PO-1', status: 'confirmed', latestSnapshot: snapshotWithRows(['row-1']) },
    ]);
    expect(coverage.coveredRows).toBe(1);
    expect(coverage.rowToPos['row-2']).toBeUndefined();
    expect(coverage.uncoveredByGarment['g-1']).toBe(1);
  });

  it('lists every covering PO for overlapping rows', () => {
    const coverage = computeCoverage(rows, [
      { poId: 'po-1', poNumber: 'PO-1', status: 'sent', latestSnapshot: snapshotWithRows(['row-1']) },
      { poId: 'po-2', poNumber: 'PO-2', status: 'draft', latestSnapshot: snapshotWithRows(['row-1', 'row-3'], 'g-2') },
    ]);

    expect(coverage.rowToPos['row-1']).toEqual([
      { poId: 'po-1', poNumber: 'PO-1' },
      { poId: 'po-2', poNumber: 'PO-2' },
    ]);
    expect(coverage.coveredRows).toBe(2);
  });

  it('ignores snapshot lines whose rows were deleted from the order', () => {
    const coverage = computeCoverage(rows, [
      { poId: 'po-1', poNumber: 'PO-1', status: 'sent', latestSnapshot: snapshotWithRows(['row-1', 'row-ghost']) },
    ]);
    expect(coverage.coveredRows).toBe(1);
    expect(coverage.rowToPos['row-ghost']).toBeUndefined();
  });

  it('reports 0% for an order with no sizing rows', () => {
    const coverage = computeCoverage([], []);
    expect(coverage).toEqual({
      totalRows: 0,
      coveredRows: 0,
      percentage: 0,
      rowToPos: {},
      uncoveredByGarment: {},
    });
  });
});
