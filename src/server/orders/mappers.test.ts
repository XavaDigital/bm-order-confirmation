import { describe, expect, it } from 'vitest';
import { toGarmentDto, toSizingDto } from './mappers';

const garment = {
  name: 'Home Jersey',
  fabrics: ['Dry-fit', 'Mesh'],
  notes: 'note',
  selectedOptions: { 'Zip Type': 'pullover' },
  selectedFabrics: { 'Outer Fabric': 'Cotton Fleece' },
  garmentType: { name: 'Pullover Hoodie' },
  sizing: [
    { size: 'M', playerName: 'Alex', playerNumber: '7', notes: 'sz note', rosterMemberId: 'rm-1' },
    { size: null, playerName: null, playerNumber: null, notes: null, rosterMemberId: null },
  ],
};

describe('toGarmentDto', () => {
  it('projects the shared garment DTO shape', () => {
    expect(toGarmentDto(garment)).toEqual({
      name: 'Home Jersey',
      fabrics: ['Dry-fit', 'Mesh'],
      notes: 'note',
      garmentTypeName: 'Pullover Hoodie',
      selectedOptions: { 'Zip Type': 'pullover' },
      selectedFabrics: { 'Outer Fabric': 'Cotton Fleece' },
      sizingColumns: [],
      sizing: [
        {
          size: 'M',
          playerName: 'Alex',
          playerNumber: '7',
          // Defaulted by the mapper — the source row carries no quantity.
          quantity: 1,
          notes: 'sz note',
          customValues: null,
        },
        {
          size: null,
          playerName: null,
          playerNumber: null,
          quantity: 1,
          notes: null,
          customValues: null,
        },
      ],
      nameListEnabled: false,
      nameListRows: null,
      nameListEntries: [],
    });
  });

  it('normalizes missing fields: non-array fabrics -> [], absent type/options -> null', () => {
    const dto = toGarmentDto({ name: 'Plain Tee', fabrics: null, notes: null, sizing: [] });
    expect(dto).toEqual({
      name: 'Plain Tee',
      fabrics: [],
      notes: null,
      garmentTypeName: null,
      selectedOptions: null,
      selectedFabrics: null,
      sizingColumns: [],
      sizing: [],
      nameListEnabled: false,
      nameListRows: null,
      nameListEntries: [],
    });
  });

  it('projects nameListEntries and defaults nameListRows to null', () => {
    const dto = toGarmentDto({
      name: 'Tribute Tee',
      fabrics: [],
      notes: null,
      sizing: [],
      nameListEnabled: true,
      nameListRows: 5,
      nameListEntries: [{ id: 'nl-1', name: 'Jamie', playerNumber: null }],
    });
    expect(dto.nameListEnabled).toBe(true);
    expect(dto.nameListRows).toBe(5);
    expect(dto.nameListEntries).toEqual([{ id: 'nl-1', name: 'Jamie', playerNumber: null }]);
  });

  it('adds viaTeamRoster per sizing row only when rosterFlags is set', () => {
    const plain = toGarmentDto(garment);
    expect(plain.sizing.every((row) => !('viaTeamRoster' in row))).toBe(true);

    const flagged = toGarmentDto(garment, { rosterFlags: true });
    expect(flagged.sizing.map((row) => row.viaTeamRoster)).toEqual([true, false]);
  });
});

describe('toSizingDto', () => {
  it('never carries rosterMemberId through', () => {
    const row = toSizingDto(garment.sizing[0]);
    expect(row).toEqual({
      size: 'M',
      playerName: 'Alex',
      playerNumber: '7',
      quantity: 1,
      notes: 'sz note',
      customValues: null,
    });
    expect('rosterMemberId' in row).toBe(false);
  });
});
