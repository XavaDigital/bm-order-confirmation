/**
 * Zod contracts + status machine for purchase orders (PO_PLAN).
 *
 * `canTransition` is the single source of truth for the PO lifecycle — the
 * service guards every status write with it, and the UI derives its action
 * buttons from the same function. Keep it pure so the full matrix stays
 * trivially unit-testable.
 */
import { z } from 'zod';

// Mirrors the `po_status` pg enum in src/db/schema.ts (order matters only for
// readability — the transition chain below is the behavioral ordering).
// David's 2026-08-05 production vocabulary. Value names ≠ display labels:
// sent renders UNCONFIRMED, pre_production DESIGN PREP, in_production
// PRODUCTION, in_transit SHIPPING (see PO_STATUS in src/lib/status.ts).
// `confirmed` is legacy — the new flow goes sent → pre_production directly,
// but existing rows hold it and it stays in the chain.
export const PO_STATUSES = [
  'draft',
  'approved', // internal sign-off before sending (2026-08-05); supplier never sees it
  'sent',
  'confirmed',
  'pre_production',
  'test_print',
  'prod_layout',
  'in_production',
  'quality_control',
  'in_transit',
  'received',
  'completed',
  'remake',
  'cancelled',
] as const;

export type PoStatus = (typeof PO_STATUSES)[number];

/** The forward production chain — any jump to a LATER entry is legal. */
const FORWARD_CHAIN: readonly PoStatus[] = [
  'draft',
  'approved',
  'sent',
  'confirmed',
  'pre_production',
  'test_print',
  'prod_layout',
  'in_production',
  'quality_control',
  'in_transit',
  'received',
  'completed',
];

/** Statuses a PO can be cancelled from (production hasn't started in earnest). */
const CANCELLABLE_FROM: readonly PoStatus[] = [
  'draft',
  'approved',
  'sent',
  'confirmed',
  'pre_production',
  'test_print',
  'prod_layout',
];

/**
 * Legal PO status transitions:
 *  - forward along the chain draft→sent→confirmed→pre_production(design prep)
 *    →test_print→prod_layout→in_production→quality_control→in_transit
 *    →received→completed, jumps allowed (e.g. draft→in_production);
 *  - → cancelled only from the pre-production phases (terminal);
 *  - → remake only from received|completed (goods came back wrong);
 *  - remake → pre_production|in_production (re-entry into production);
 *  - no backward moves, nothing out of cancelled, and completed only → remake.
 */
export function canTransition(from: PoStatus, to: PoStatus): boolean {
  if (from === to) return false;
  if (from === 'cancelled') return false; // terminal
  if (from === 'remake') return to === 'pre_production' || to === 'in_production';
  if (to === 'cancelled') return CANCELLABLE_FROM.includes(from);
  if (to === 'remake') return from === 'received' || from === 'completed';
  const fromIdx = FORWARD_CHAIN.indexOf(from);
  const toIdx = FORWARD_CHAIN.indexOf(to);
  return fromIdx !== -1 && toIdx !== -1 && toIdx > fromIdx;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Dates travel as YYYY-MM-DD strings (drizzle `date` column mode) — same as
// the admin order contract, with the shape pinned down.
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

export const createPurchaseOrderSchema = z.object({
  orderId: z.string().uuid(),
  supplierId: z.string().uuid(),
  /** The garments (of that order) this PO covers — snapshot scope. */
  garmentIds: z.array(z.string().uuid()).min(1),
  // No deadlineDate here — David reversed the earlier split on 2026-08-05:
  // the PO's deadline IS the customer deadline, copied from
  // `orders.deadlineDate` at create (and re-synced when the order's changes)
  // so production staff can spot jobs cutting it fine. It is INTERNAL: it
  // must never render on the supplier portal, the PO PDF, or the XLSX.
  expectedShipDate: dateString.optional(),
  notes: z.string().max(2000).optional(),
  /**
   * Which of the supplier's colour books the job is matched against (David,
   * 2026-08-05). Omitted = the supplier's newest book (the default); a
   * reprint can pick an older one explicitly.
   */
  colorBookId: z.string().uuid().optional(),
});

export const updatePurchaseOrderSchema = z.object({
  // deadlineDate is deliberately absent: it mirrors the order's customer
  // deadline automatically and is not editable per PO.
  expectedShipDate: dateString.nullable().optional(),
  actualShipDate: dateString.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** null clears the book (no colour matching recorded). */
  colorBookId: z.string().uuid().nullable().optional(),
});

export const updatePoStatusSchema = z.object({
  status: z.enum(PO_STATUSES),
});

export const issueRevisionSchema = z.object({
  /** Why this revision was issued — required (revision 1 is the only reasonless one). */
  reason: z.string().trim().min(1).max(500),
  /** Optional override of the garment scope; defaults to the previous revision's garments. */
  garmentIds: z.array(z.string().uuid()).min(1).optional(),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type UpdatePoStatusInput = z.infer<typeof updatePoStatusSchema>;
export type IssueRevisionInput = z.infer<typeof issueRevisionSchema>;
