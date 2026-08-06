import { describe, expect, it } from 'vitest';
import type { PoSnapshot, PoSnapshotGarment, PoSnapshotLine } from '@/db/schema';
import { diffPoSnapshots, garmentHasChanges, lineFieldLabel } from './po-diff';

function line(overrides: Partial<PoSnapshotLine> & { sizingRowId: string }): PoSnapshotLine {
  return {
    size: 'M',
    playerName: null,
    playerNumber: null,
    quantity: 1,
    customValues: null,
    notes: null,
    ...overrides,
  } as PoSnapshotLine;
}

function garment(
  overrides: Partial<PoSnapshotGarment> & { garmentId: string },
): PoSnapshotGarment {
  return {
    name: 'Hoodie',
    garmentTypeId: null,
    garmentTypeName: null,
    fabrics: [],
    selectedFabrics: null,
    selectedOptions: null,
    sizingColumns: [],
    notes: null,
    lines: [],
    ...overrides,
  } as PoSnapshotGarment;
}

function snapshot(garments: PoSnapshotGarment[]): PoSnapshot {
  return { orderNumber: 'OC-1', garments } as PoSnapshot;
}

describe('diffPoSnapshots', () => {
  it('reports no changes for identical snapshots', () => {
    const snap = snapshot([garment({ garmentId: 'g1', lines: [line({ sizingRowId: 'r1' })] })]);
    const diff = diffPoSnapshots(snap, snapshot([garment({ garmentId: 'g1', lines: [line({ sizingRowId: 'r1' })] })]));

    expect(diff.hasChanges).toBe(false);
    expect(diff.summary).toEqual([]);
    expect(diff.addedGarments).toEqual([]);
    expect(diff.removedGarments).toEqual([]);
    expect(diff.changedGarments).toEqual({});
  });

  it('detects added and removed garments by garmentId', () => {
    const prev = snapshot([garment({ garmentId: 'g1', name: 'Hoodie' })]);
    const next = snapshot([garment({ garmentId: 'g2', name: 'Singlet' })]);

    const diff = diffPoSnapshots(prev, next);
    expect(diff.addedGarments).toEqual([{ garmentId: 'g2', name: 'Singlet' }]);
    expect(diff.removedGarments).toEqual([{ garmentId: 'g1', name: 'Hoodie' }]);
    expect(diff.summary).toEqual(['Garment added: Singlet', 'Garment removed: Hoodie']);
    expect(diff.hasChanges).toBe(true);
  });

  it('matches sizing lines by sizingRowId: added, removed, and per-field changes', () => {
    const prev = snapshot([
      garment({
        garmentId: 'g1',
        sizingColumns: [{ label: 'Colour', type: 'select', options: ['Red', 'Blue'] }],
        lines: [
          line({ sizingRowId: 'r1', size: 'M', playerName: 'Alice', quantity: 1 }),
          line({ sizingRowId: 'r2', size: 'S', playerName: 'Bob', playerNumber: '9' }),
        ],
      }),
    ]);
    const next = snapshot([
      garment({
        garmentId: 'g1',
        sizingColumns: [{ label: 'Colour', type: 'select', options: ['Red', 'Blue'] }],
        lines: [
          // r1 changed: size M→L, quantity 1→2, custom Colour set
          line({
            sizingRowId: 'r1',
            size: 'L',
            playerName: 'Alice',
            quantity: 2,
            customValues: { Colour: 'Red' },
          }),
          // r2 removed; r3 added
          line({ sizingRowId: 'r3', size: 'XL', playerName: 'Cara' }),
        ],
      }),
    ]);

    const diff = diffPoSnapshots(prev, next);
    const g = diff.changedGarments.g1;
    expect(g).toBeDefined();
    expect(g.addedLineIds).toEqual(['r3']);
    expect(g.removedLines.map((l) => l.sizingRowId)).toEqual(['r2']);
    expect(g.changedLineFields).toEqual({ r1: ['size', 'quantity', 'custom:Colour'] });
    expect(garmentHasChanges(g)).toBe(true);

    expect(diff.summary).toEqual([
      'Hoodie: 1 sizing line added',
      'Hoodie: sizing line removed (S · Bob · #9)',
      'Hoodie: 1 sizing line changed (Size, Qty, Colour)',
    ]);
  });

  it('treats a missing quantity as 1 (pre-0025 revisions) and ignores whitespace-only differences', () => {
    const prev = snapshot([
      garment({
        garmentId: 'g1',
        lines: [line({ sizingRowId: 'r1', quantity: undefined, playerName: ' Alice ' })],
      }),
    ]);
    const next = snapshot([
      garment({
        garmentId: 'g1',
        lines: [line({ sizingRowId: 'r1', quantity: 1, playerName: 'Alice' })],
      }),
    ]);

    expect(diffPoSnapshots(prev, next).hasChanges).toBe(false);
  });

  it('detects changed option values, fabric picks, notes, and renames', () => {
    const prev = snapshot([
      garment({
        garmentId: 'g1',
        name: 'Hoodie',
        selectedOptions: { Trim: 'Gold', Zip: 'Full' },
        selectedFabrics: { Main: 'Cotton' },
        fabrics: ['Mesh'],
        notes: 'old note',
      }),
    ]);
    const next = snapshot([
      garment({
        garmentId: 'g1',
        name: 'Team Hoodie',
        selectedOptions: { Trim: 'Silver', Zip: 'Full' },
        selectedFabrics: { Main: 'Poly' },
        fabrics: ['Mesh', 'Fleece'],
        notes: 'new note',
      }),
    ]);

    const diff = diffPoSnapshots(prev, next);
    const g = diff.changedGarments.g1;
    expect(g.renamedFrom).toBe('Hoodie');
    expect(g.changedOptionLabels).toEqual(['Trim']);
    expect(g.changedFabricLabels).toEqual(['Main']);
    expect(g.fabricsListChanged).toBe(true);
    expect(g.notesChanged).toBe(true);
    expect(diff.summary).toEqual([
      'Team Hoodie: renamed from “Hoodie”',
      'Team Hoodie: fabrics changed — Main',
      'Team Hoodie: options changed — Trim',
      'Team Hoodie: notes changed',
    ]);
  });

  it('flags an option that appears or disappears between revisions', () => {
    const prev = snapshot([garment({ garmentId: 'g1', selectedOptions: { Trim: 'Gold' } })]);
    const next = snapshot([
      garment({ garmentId: 'g1', selectedOptions: { Trim: 'Gold', Collar: 'V-neck' } }),
    ]);

    const diff = diffPoSnapshots(prev, next);
    expect(diff.changedGarments.g1.changedOptionLabels).toEqual(['Collar']);
  });
});

describe('lineFieldLabel', () => {
  it('maps fixed keys to the table headers and strips the custom prefix', () => {
    expect(lineFieldLabel('size')).toBe('Size');
    expect(lineFieldLabel('playerName')).toBe('Player Name');
    expect(lineFieldLabel('playerNumber')).toBe('Number');
    expect(lineFieldLabel('quantity')).toBe('Qty');
    expect(lineFieldLabel('notes')).toBe('Notes');
    expect(lineFieldLabel('custom:Colour')).toBe('Colour');
  });
});
