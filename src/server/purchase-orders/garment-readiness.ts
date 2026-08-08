/**
 * Is every garment on this purchase order actually specified? (David, 2026-08-08)
 *
 * Four things a factory cannot work without: a picture of the garment, a size
 * chart to cut to, a fabric, and an answer to every required option (cord
 * colour, button colour, and the rest).
 *
 * Reported at TWO levels on purpose, which is David's ruling:
 *  - PO-WIDE, as pre-send checklist lines ("Size charts for all garments") —
 *    that is what blocks the send, and it is one line whatever the garment
 *    count;
 *  - PER GARMENT, shown inside that garment's own box on the purchase order
 *    screen — because "size charts missing" across eleven garments is not
 *    something anyone can act on without being told WHICH.
 *
 * Both read from this one evaluation, so the checklist and the garment boxes
 * can never disagree about whether something is missing.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { garments, purchaseOrderRevisions, purchaseOrders } from '@/db/schema';
import { effectiveFabrics } from '@/lib/fabric-fields';
import { missingRequiredOptions } from '@/server/garment-types/visibility';

/** The four garment-level requirements, as machine keys the UI can group on. */
export type GarmentRequirement = 'image' | 'sizeChart' | 'fabric' | 'requiredOptions';

export interface GarmentIssue {
  requirement: GarmentRequirement;
  /** Reads on its own inside the garment's box: "No size chart linked". */
  label: string;
}

export interface GarmentReadiness {
  garmentId: string;
  name: string;
  issues: GarmentIssue[];
  ready: boolean;
}

export interface PoGarmentReadiness {
  garments: GarmentReadiness[];
  /** One flag per PO-wide checklist line. True when NO garment fails it. */
  allHaveImage: boolean;
  allHaveSizeChart: boolean;
  allHaveFabric: boolean;
  allRequiredOptionsAnswered: boolean;
}

const EMPTY: PoGarmentReadiness = {
  garments: [],
  allHaveImage: true,
  allHaveSizeChart: true,
  allHaveFabric: true,
  allRequiredOptionsAnswered: true,
};

/**
 * The garments this purchase order covers, from its latest revision snapshot.
 *
 * The snapshot is the scope of record — a PO covers a SUBSET of its order's
 * garments, and reading the order's garments instead would fail a purchase
 * order over a garment it was never for. The live rows are then loaded for
 * those ids, because the question is whether the garment is specified NOW, not
 * whether it was when the snapshot was cut.
 */
async function scopedGarmentIds(poId: string): Promise<string[]> {
  const latest = await db.query.purchaseOrderRevisions.findFirst({
    where: eq(purchaseOrderRevisions.poId, poId),
    orderBy: (r, { desc }) => [desc(r.revisionNumber)],
  });
  const rows = latest?.snapshot?.garments ?? [];
  return rows.map((g) => g.garmentId).filter((id): id is string => typeof id === 'string');
}

/** Every unmet requirement for one garment, in the order a person would check them. */
export function garmentIssues(garment: {
  images: unknown[];
  sizeChartLinks: unknown[];
  fabrics: string[] | null;
  selectedFabrics: Record<string, string> | null;
  selectedOptions: Record<string, string> | null;
  garmentType: { orderOptions: unknown } | null;
}): GarmentIssue[] {
  const issues: GarmentIssue[] = [];

  // No "featured" flag exists on mock-up images, so the requirement is read as
  // "has at least one image" — which is what the factory document needs.
  if (garment.images.length === 0) {
    issues.push({ requirement: 'image', label: 'No image uploaded' });
  }
  if (garment.sizeChartLinks.length === 0) {
    issues.push({ requirement: 'sizeChart', label: 'No size chart linked' });
  }
  if (effectiveFabrics(garment).length === 0) {
    issues.push({ requirement: 'fabric', label: 'No fabric selected' });
  }

  // Typeless garments have no option set, so nothing can be required of them.
  const orderOptions = garment.garmentType?.orderOptions;
  if (Array.isArray(orderOptions)) {
    const missing = missingRequiredOptions(orderOptions, garment.selectedOptions);
    if (missing.length > 0) {
      issues.push({
        requirement: 'requiredOptions',
        label: `Required options not set: ${missing.join(', ')}`,
      });
    }
  }

  return issues;
}

/** Per-garment readiness for one purchase order, plus the PO-wide roll-ups. */
export async function evaluatePoGarmentReadiness(poId: string): Promise<PoGarmentReadiness> {
  const po = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, poId),
    columns: { id: true },
  });
  if (!po) return EMPTY;

  const ids = await scopedGarmentIds(poId);
  if (ids.length === 0) return EMPTY;

  const rows = await db.query.garments.findMany({
    where: (g, { inArray }) => inArray(g.id, ids),
    orderBy: (g, { asc }) => [asc(g.sortOrder), asc(g.createdAt)],
    with: {
      images: true,
      sizeChartLinks: true,
      garmentType: { columns: { orderOptions: true } },
    },
  });

  const list: GarmentReadiness[] = rows.map((g) => {
    const issues = garmentIssues(g);
    return { garmentId: g.id, name: g.name, issues, ready: issues.length === 0 };
  });

  const noneFail = (requirement: GarmentRequirement) =>
    !list.some((g) => g.issues.some((i) => i.requirement === requirement));

  return {
    garments: list,
    allHaveImage: noneFail('image'),
    allHaveSizeChart: noneFail('sizeChart'),
    allHaveFabric: noneFail('fabric'),
    allRequiredOptionsAnswered: noneFail('requiredOptions'),
  };
}
