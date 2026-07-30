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
      reprintOfOrderNumber: null,
      preparedByEmail: null,
      checks: [],
      assets: [],
      garments: [
        {
          garmentId: 'g-1',
          name: 'Team Hoodie',
          garmentTypeId: 'type-1',
          garmentTypeName: 'Pullover Hoodie',
          fabrics: ['Cotton Fleece'],
          selectedFabrics: { 'Outer Fabric': 'Cotton Fleece' },
          selectedOptions: { 'Zip Type': 'pullover' },
          sizingColumns: [],
          // Empty because the fixture loaded no chart links — [] means "loaded
          // and none", distinct from a legacy snapshot's missing key.
          sizeCharts: [],
          notes: 'front print',
          lines: [
            {
              sizingRowId: 'row-1',
              size: 'M',
              playerName: 'Alice',
              playerNumber: '7',
              // Defaulted, not supplied — a line with no quantity is one garment.
              quantity: 1,
              notes: null,
              customValues: null,
            },
            {
              sizingRowId: 'row-2',
              size: 'L',
              playerName: 'Bob',
              playerNumber: '8',
              quantity: 1,
              notes: 'long sleeve',
              customValues: null,
            },
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

describe('custom sizing columns', () => {
  const columns = [
    { label: 'Colour', type: 'select' as const, options: ['Navy', 'Red'] },
    { label: 'Sponsor', type: 'text' as const },
  ];

  it('captures the column definitions and per-line values into the snapshot', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        sizingColumns: columns,
        sizing: [
          {
            id: 'row-1',
            size: 'M',
            playerName: null,
            playerNumber: null,
            notes: null,
            customValues: { Colour: 'Navy', Sponsor: 'Acme' },
          },
        ],
      }),
    ]);

    expect(snapshot.garments[0].sizingColumns).toEqual(columns);
    expect(snapshot.garments[0].lines[0].customValues).toEqual({
      Colour: 'Navy',
      Sponsor: 'Acme',
    });
  });

  it('reports a changed custom value as variance, named by its column', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        sizingColumns: columns,
        sizing: [
          {
            id: 'row-1',
            size: 'M',
            playerName: null,
            playerNumber: null,
            notes: null,
            customValues: { Colour: 'Navy' },
          },
        ],
      }),
    ]);

    const variance = detectVariance(
      [
        liveGarment({
          sizingColumns: columns,
          sizing: [
            {
              id: 'row-1',
              size: 'M',
              playerName: null,
              playerNumber: null,
              notes: null,
              customValues: { Colour: 'Red' },
            },
          ],
        }),
      ],
      snapshot,
    );

    const line = variance.garments[0].lines[0];
    expect(line.change).toBe('modified');
    expect(line.fieldChanges).toEqual([{ field: 'Colour', from: 'Navy', to: 'Red' }]);
    expect(variance.hasVariance).toBe(true);
  });

  it('reports a newly filled custom value as variance', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        sizingColumns: columns,
        sizing: [
          { id: 'row-1', size: 'M', playerName: null, playerNumber: null, notes: null },
        ],
      }),
    ]);

    const variance = detectVariance(
      [
        liveGarment({
          sizingColumns: columns,
          sizing: [
            {
              id: 'row-1',
              size: 'M',
              playerName: null,
              playerNumber: null,
              notes: null,
              customValues: { Sponsor: 'Acme' },
            },
          ],
        }),
      ],
      snapshot,
    );

    expect(variance.garments[0].lines[0].fieldChanges).toEqual([
      { field: 'Sponsor', from: null, to: 'Acme' },
    ]);
  });

  it('does not report variance when custom values are unchanged', () => {
    const rows = [
      {
        id: 'row-1',
        size: 'M',
        playerName: null,
        playerNumber: null,
        notes: null,
        customValues: { Colour: 'Navy' },
      },
    ];
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({ sizingColumns: columns, sizing: rows }),
    ]);

    const variance = detectVariance(
      [liveGarment({ sizingColumns: columns, sizing: rows })],
      snapshot,
    );

    expect(variance.garments[0].status).toBe('unchanged');
    expect(variance.garments[0].lines).toHaveLength(0);
    expect(variance.hasVariance).toBe(false);
  });
});

describe('factory-facing context', () => {
  it('captures assets and the reprint reference into the snapshot', () => {
    const snapshot = buildPoSnapshot(
      { orderNumber: 'OC-2', reprintOfOrderNumber: 'OC-1' },
      [liveGarment()],
      [
        {
          kind: 'design',
          name: 'Front print',
          url: 'https://drive.example/abc',
          notes: null,
          garmentName: 'Team Hoodie',
        },
      ],
    );

    expect(snapshot.reprintOfOrderNumber).toBe('OC-1');
    expect(snapshot.assets).toEqual([
      {
        kind: 'design',
        name: 'Front print',
        url: 'https://drive.example/abc',
        notes: null,
        garmentName: 'Team Hoodie',
      },
    ]);
  });

  it('defaults to no assets and no reprint reference', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [liveGarment()]);

    expect(snapshot.assets).toEqual([]);
    expect(snapshot.reprintOfOrderNumber).toBeNull();
  });
});

/**
 * Quantity arrived in 0025. Every revision cut before it has no such field, and
 * a line back then meant exactly one garment — so the default is 1 everywhere,
 * and the risk is a historical PO silently changing meaning.
 */
describe('line quantity', () => {
  it('snapshots the quantity on a line', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        sizing: [{ id: 'row-1', size: 'M', playerName: null, playerNumber: null, quantity: 20, notes: null }],
      }),
    ]);

    expect(snapshot.garments[0].lines[0].quantity).toBe(20);
  });

  it('treats a live row with no quantity as one', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [liveGarment()]);

    expect(snapshot.garments[0].lines[0].quantity).toBe(1);
  });

  it('sums quantity rather than counting rows', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        sizing: [
          { id: 'row-1', size: 'M', playerName: null, playerNumber: null, quantity: 20, notes: null },
          { id: 'row-2', size: 'M', playerName: null, playerNumber: null, quantity: 5, notes: null },
          { id: 'row-3', size: 'L', playerName: 'Alice', playerNumber: '7', notes: null },
        ],
      }),
    ]);

    const summary = sizeSummary(snapshot);

    expect(summary.perGarment[0].counts).toEqual({ M: 25, L: 1 });
    expect(summary.perGarment[0].total).toBe(26);
    expect(summary.grandTotal).toBe(26);
  });

  // An old snapshot has no quantity at all; its totals must not change.
  it('counts a pre-quantity snapshot line as one', () => {
    const legacy = {
      orderNumber: 'OC-1',
      garments: [
        {
          garmentId: 'g-1',
          name: 'Team Hoodie',
          garmentTypeId: null,
          garmentTypeName: null,
          fabrics: [],
          selectedFabrics: null,
          selectedOptions: null,
          notes: null,
          lines: [
            { sizingRowId: 'row-1', size: 'M', playerName: null, playerNumber: null, notes: null },
          ],
        },
      ],
    } as PoSnapshot;

    expect(sizeSummary(legacy).grandTotal).toBe(1);
  });

  it('reports a changed quantity as variance', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        sizing: [{ id: 'row-1', size: 'M', playerName: null, playerNumber: null, quantity: 10, notes: null }],
      }),
    ]);
    const live = liveGarment({
      sizing: [{ id: 'row-1', size: 'M', playerName: null, playerNumber: null, quantity: 12, notes: null }],
    });

    const variance = detectVariance([live], snapshot);

    expect(variance.hasVariance).toBe(true);
    expect(variance.garments[0].lines[0].fieldChanges).toContainEqual({
      field: 'quantity',
      from: 10,
      to: 12,
    });
  });

  /**
   * The regression that would have hit every PO in the database at once: an old
   * snapshot has `quantity: undefined`, the live row reads 1, and comparing raw
   * would call that a change on every line of every pre-existing PO.
   */
  it('does not invent variance between a pre-quantity snapshot and a live row of one', () => {
    const legacy = {
      orderNumber: 'OC-1',
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
          ],
        },
      ],
    } as PoSnapshot;
    const live = liveGarment({
      sizing: [{ id: 'row-1', size: 'M', playerName: 'Alice', playerNumber: '7', quantity: 1, notes: null }],
    });

    expect(detectVariance([live], legacy).hasVariance).toBe(false);
  });
});

/**
 * The gap that prompted this work: swapping the font on an order left an
 * already-sent PO stale, and nothing said so.
 */
describe('asset variance', () => {
  const font = {
    kind: 'font' as const,
    name: 'Squad Numbers',
    usage: 'playerNumber',
    url: 'https://drive.example/font-v1',
    notes: null,
    garmentName: 'Team Hoodie',
  };

  function snapshotWith(assets: typeof font[]) {
    return buildPoSnapshot({ orderNumber: 'OC-1' }, [liveGarment()], assets);
  }

  it('reports a font whose link changed', () => {
    const variance = detectVariance([liveGarment()], snapshotWith([font]), [
      { ...font, url: 'https://drive.example/font-v2' },
    ]);

    expect(variance.hasVariance).toBe(true);
    expect(variance.assets).toEqual([
      {
        change: 'modified',
        name: 'Squad Numbers',
        garmentName: 'Team Hoodie',
        fieldChanges: [
          { field: 'url', from: 'https://drive.example/font-v1', to: 'https://drive.example/font-v2' },
        ],
      },
    ]);
  });

  it('reports a font whose usage was re-pointed at another field', () => {
    const variance = detectVariance([liveGarment()], snapshotWith([font]), [
      { ...font, usage: 'playerName' },
    ]);

    expect(variance.assets[0].fieldChanges).toEqual([
      { field: 'usage', from: 'playerNumber', to: 'playerName' },
    ]);
  });

  it('reports an added and a removed file', () => {
    const added = detectVariance([liveGarment()], snapshotWith([]), [font]);
    expect(added.assets).toEqual([
      { change: 'added', name: 'Squad Numbers', garmentName: 'Team Hoodie' },
    ]);

    const removed = detectVariance([liveGarment()], snapshotWith([font]), []);
    expect(removed.assets).toEqual([
      { change: 'removed', name: 'Squad Numbers', garmentName: 'Team Hoodie' },
    ]);
  });

  it('is quiet when the files match', () => {
    const variance = detectVariance([liveGarment()], snapshotWith([font]), [font]);

    expect(variance.assets).toEqual([]);
    expect(variance.hasVariance).toBe(false);
  });

  // Callers that only care about garments must not be told the files vanished.
  it('reports nothing when live assets are not supplied', () => {
    const variance = detectVariance([liveGarment()], snapshotWith([font]));

    expect(variance.assets).toEqual([]);
    expect(variance.hasVariance).toBe(false);
  });

  it('counts asset changes in the variance banner', () => {
    const variance = detectVariance([liveGarment()], snapshotWith([font]), [
      { ...font, url: 'https://drive.example/font-v2' },
    ]);

    expect(varianceCounts(variance)).toEqual({ added: 0, modified: 1, removed: 0 });
  });
});

/**
 * Size charts entered the snapshot after quantity did, so the same
 * compatibility rule applies: a snapshot that never recorded charts must not
 * produce variance against a live garment that has them.
 */
describe('size charts in the snapshot', () => {
  const chartLink = (id: string, name: string) => ({
    sizeChart: { id, name, storageKey: `size-charts/${id}.png` },
  });

  it('captures linked charts, sorted and without dangling links', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({
        sizeChartLinks: [
          chartLink('c2', 'Womens Fitted'),
          chartLink('c1', 'Adult Unisex'),
          { sizeChart: null }, // dangling link row — dropped, not crashed on
        ],
      }),
    ]);

    expect(snapshot.garments[0].sizeCharts).toEqual([
      { id: 'c1', name: 'Adult Unisex', storageKey: 'size-charts/c1.png' },
      { id: 'c2', name: 'Womens Fitted', storageKey: 'size-charts/c2.png' },
    ]);
  });

  it('snapshots an empty list when the relation was loaded and empty', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({ sizeChartLinks: [] }),
    ]);

    expect(snapshot.garments[0].sizeCharts).toEqual([]);
  });

  it('reports a re-linked chart as variance, by name', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({ sizeChartLinks: [chartLink('c1', 'Adult Unisex')] }),
    ]);
    const live = liveGarment({ sizeChartLinks: [chartLink('c2', 'Womens Fitted')] });

    const variance = detectVariance([live], snapshot);

    expect(variance.hasVariance).toBe(true);
    expect(variance.garments[0].fieldChanges).toContainEqual({
      field: 'sizeCharts',
      from: ['Adult Unisex'],
      to: ['Womens Fitted'],
    });
  });

  // Renaming a chart in the library must not flag every PO that references it.
  it('does not report a renamed chart as variance', () => {
    const snapshot = buildPoSnapshot({ orderNumber: 'OC-1' }, [
      liveGarment({ sizeChartLinks: [chartLink('c1', 'Adult Unisex')] }),
    ]);
    const live = liveGarment({ sizeChartLinks: [chartLink('c1', 'Adult Unisex v2')] });

    expect(detectVariance([live], snapshot).hasVariance).toBe(false);
  });

  /**
   * The back-compat case: a revision cut before charts were captured has no
   * sizeCharts key at all. What it was linked to is unknowable, so it must not
   * be compared — flagging every pre-existing PO would teach people to ignore
   * the variance banner.
   */
  it('does not invent variance for a snapshot that predates chart capture', () => {
    const legacy = {
      orderNumber: 'OC-1',
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
          lines: [],
        },
      ],
    } as PoSnapshot;
    const live = liveGarment({
      sizing: [],
      sizeChartLinks: [chartLink('c1', 'Adult Unisex')],
    });

    expect(detectVariance([live], legacy).hasVariance).toBe(false);
  });
});

describe('provenance in the snapshot', () => {
  it('records who prepared the revision and which checks preceded it', () => {
    const snapshot = buildPoSnapshot(
      { orderNumber: 'OC-1', preparedByEmail: 'sam@beastmode.co.nz' },
      [liveGarment()],
      [],
      [
        {
          taskName: 'Artwork approved',
          stageName: 'Artwork',
          byEmail: 'ana@beastmode.co.nz',
          at: '2026-07-30T01:00:00.000Z',
        },
        // The same task confirmed by a second person IS the double-check.
        {
          taskName: 'Artwork approved',
          stageName: 'Artwork',
          byEmail: 'ben@beastmode.co.nz',
          at: '2026-07-30T02:00:00.000Z',
        },
      ],
    );

    expect(snapshot.preparedByEmail).toBe('sam@beastmode.co.nz');
    expect(snapshot.checks).toHaveLength(2);
    expect(snapshot.checks?.map((c) => c.byEmail)).toEqual([
      'ana@beastmode.co.nz',
      'ben@beastmode.co.nz',
    ]);
  });
});
