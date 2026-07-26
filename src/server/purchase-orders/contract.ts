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
export const PO_STATUSES = [
  'draft',
  'sent',
  'confirmed',
  'pre_production',
  'in_production',
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
  'sent',
  'confirmed',
  'pre_production',
  'in_production',
  'in_transit',
  'received',
  'completed',
];

/** Statuses a PO can be cancelled from (production hasn't started in earnest). */
const CANCELLABLE_FROM: readonly PoStatus[] = ['draft', 'sent', 'confirmed', 'pre_production'];

/**
 * Legal PO status transitions:
 *  - forward along the chain draft→sent→confirmed→pre_production→in_production
 *    →in_transit→received→completed, jumps allowed (e.g. draft→in_production);
 *  - → cancelled only from draft|sent|confirmed|pre_production (terminal);
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
  deadlineDate: dateString.optional(),
  expectedShipDate: dateString.optional(),
  notes: z.string().max(2000).optional(),
});

export const updatePurchaseOrderSchema = z.object({
  deadlineDate: dateString.nullable().optional(),
  expectedShipDate: dateString.nullable().optional(),
  actualShipDate: dateString.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
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
