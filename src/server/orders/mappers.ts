/**
 * Pure garment→DTO projections shared by the customer order page, the admin
 * PDF route, and the confirmation snapshot builder. Keep this module free of
 * I/O (no db, no storage) so it stays trivially unit-testable.
 */

export interface GarmentSizingDto {
  size: string | null;
  playerName: string | null;
  playerNumber: string | null;
  notes: string | null;
  /** Only present when mapped with `{ rosterFlags: true }`. */
  viaTeamRoster?: boolean;
}

export interface GarmentDto {
  name: string;
  fabrics: string[];
  notes: string | null;
  garmentTypeName: string | null;
  selectedOptions: Record<string, string> | null;
  selectedFabrics: Record<string, string> | null;
  sizing: GarmentSizingDto[];
}

interface SizingRecord {
  size: string | null;
  playerName: string | null;
  playerNumber: string | null;
  notes: string | null;
  rosterMemberId?: string | null;
}

interface GarmentRecord {
  name: string;
  fabrics: unknown;
  notes: string | null;
  selectedOptions?: Record<string, string> | null;
  selectedFabrics?: Record<string, string> | null;
  garmentType?: { name: string } | null;
  sizing: SizingRecord[];
}

export function toSizingDto(row: SizingRecord): GarmentSizingDto {
  return {
    size: row.size ?? null,
    playerName: row.playerName ?? null,
    playerNumber: row.playerNumber ?? null,
    notes: row.notes ?? null,
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
    sizing: garment.sizing.map((row) =>
      opts.rosterFlags
        ? {
            ...toSizingDto(row),
            viaTeamRoster: row.rosterMemberId !== null && row.rosterMemberId !== undefined,
          }
        : toSizingDto(row),
    ),
  };
}

/**
 * Read a value from a confirmation snapshot, accepting BOTH the camelCase keys
 * written by `buildConfirmationSnapshot()` (new rows) and the legacy
 * snake_case keys present on pre-migration `confirmed_snapshot` jsonb rows.
 */
export function snap<T = unknown>(
  obj: Record<string, unknown> | null | undefined,
  camelKey: string,
  snakeKey: string,
): T | undefined {
  if (!obj) return undefined;
  if (obj[camelKey] !== undefined) return obj[camelKey] as T;
  return obj[snakeKey] as T | undefined;
}
