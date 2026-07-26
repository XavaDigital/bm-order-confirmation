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
