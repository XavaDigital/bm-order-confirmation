/**
 * Pure garment→DTO projections shared by the customer order page, the admin
 * PDF route, and the confirmation snapshot builder. Keep this module free of
 * I/O (no db, no storage) so it stays trivially unit-testable.
 */
import type { GarmentTypeOption } from '@/db/schema';

export interface GarmentSizingDto {
  size: string | null;
  playerName: string | null;
  playerNumber: string | null;
  /** How many of this line. Always a number here — a missing value reads as 1. */
  quantity: number;
  notes: string | null;
  /** Values for the garment's custom sizing columns ({label: value}). */
  customValues: Record<string, string> | null;
  /** Only present when mapped with `{ rosterFlags: true }`. */
  viaTeamRoster?: boolean;
}

export interface GarmentNameListEntryDto {
  id: string;
  name: string;
  playerNumber: string | null;
}

export interface GarmentDto {
  name: string;
  fabrics: string[];
  notes: string | null;
  garmentTypeName: string | null;
  selectedOptions: Record<string, string> | null;
  selectedFabrics: Record<string, string> | null;
  /** Custom sizing-column definitions, so a reader knows the column order. */
  sizingColumns: GarmentTypeOption[];
  sizing: GarmentSizingDto[];
  /**
   * "Got Your Back" style — a name list printed on this garment's shared
   * design, independent of `sizing` (GOT_YOUR_BACK_PLAN.md). `nameListRows`
   * is the print layout's row count; `nameListEntries` is empty/unused when
   * `nameListEnabled` is false.
   */
  nameListEnabled: boolean;
  nameListRows: number | null;
  nameListEntries: GarmentNameListEntryDto[];
}

interface SizingRecord {
  size: string | null;
  playerName: string | null;
  playerNumber: string | null;
  quantity?: number | null;
  notes: string | null;
  customValues?: Record<string, string> | null;
  rosterMemberId?: string | null;
}

interface GarmentRecord {
  name: string;
  fabrics: unknown;
  notes: string | null;
  selectedOptions?: Record<string, string> | null;
  selectedFabrics?: Record<string, string> | null;
  sizingColumns?: GarmentTypeOption[] | null;
  garmentType?: { name: string } | null;
  sizing: SizingRecord[];
  nameListEnabled?: boolean | null;
  nameListRows?: number | null;
  nameListEntries?: { id: string; name: string; playerNumber: string | null }[];
}

export function toSizingDto(row: SizingRecord): GarmentSizingDto {
  return {
    size: row.size ?? null,
    playerName: row.playerName ?? null,
    playerNumber: row.playerNumber ?? null,
    // Defaulted here so every reader — customer page, PDF, confirmation
    // snapshot — gets a number and none of them has to repeat the rule.
    quantity: row.quantity ?? 1,
    notes: row.notes ?? null,
    customValues: row.customValues ?? null,
  };
}

/**
 * Project a garment row (with its sizing relation) onto the shared DTO shape.
 *
 * @param opts.rosterFlags add `viaTeamRoster` to each sizing row (customer
 *   order page); omitted for consumers whose DTOs must not carry it (PDF,
 *   confirmation snapshot).
 */
export function toGarmentDto(
  garment: GarmentRecord,
  opts: { rosterFlags?: boolean } = {},
): GarmentDto {
  return {
    name: garment.name,
    fabrics: Array.isArray(garment.fabrics) ? (garment.fabrics as string[]) : [],
    notes: garment.notes ?? null,
    garmentTypeName: garment.garmentType?.name ?? null,
    selectedOptions: garment.selectedOptions ?? null,
    selectedFabrics: garment.selectedFabrics ?? null,
    sizingColumns: garment.sizingColumns ?? [],
    sizing: garment.sizing.map((row) =>
      opts.rosterFlags
        ? {
            ...toSizingDto(row),
            viaTeamRoster: row.rosterMemberId !== null && row.rosterMemberId !== undefined,
          }
        : toSizingDto(row),
    ),
    nameListEnabled: garment.nameListEnabled ?? false,
    nameListRows: garment.nameListRows ?? null,
    nameListEntries: (garment.nameListEntries ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      playerNumber: row.playerNumber ?? null,
    })),
  };
}
