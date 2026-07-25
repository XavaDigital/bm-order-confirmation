/**
 * Fabric-field adapter for garment types. New types define labeled fabric
 * fields (fabricFields); older rows only have the flat fabricOptions list —
 * present those as a single "Fabric" field so the one-pick-per-field UI works
 * unchanged. A legacy type upgrades to fabricFields the first time an admin
 * saves it (the editor is seeded from this adapter and writes fabricFields).
 */
import type { GarmentTypeFabricField } from '@/db/schema';

export function effectiveFabricFields(type: {
  fabricFields: GarmentTypeFabricField[];
  fabricOptions: string[];
}): GarmentTypeFabricField[] {
  if (type.fabricFields.length > 0) return type.fabricFields;
  if (type.fabricOptions.length > 0) return [{ label: 'Fabric', options: type.fabricOptions }];
  return [];
}

/**
 * THE fabric list for a garment, resolved unambiguously: typed garments store
 * labeled picks in selectedFabrics ({field: fabric}); typeless garments keep
 * the legacy free-text fabrics array. Consumers that need one flat list
 * (PDFs, purchase orders, search) use this instead of re-implementing the
 * two-representation branch.
 */
export function effectiveFabrics(garment: {
  fabrics: string[] | null;
  selectedFabrics: Record<string, string> | null;
}): string[] {
  if (garment.selectedFabrics) {
    const picks = Object.values(garment.selectedFabrics).filter(Boolean);
    if (picks.length > 0) return picks;
  }
  return garment.fabrics ?? [];
}
