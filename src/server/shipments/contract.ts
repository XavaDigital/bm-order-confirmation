/**
 * Zod contracts + status machine for shipments (PO_PLAN).
 *
 * `canTransitionShipment` is the single source of truth for the shipment
 * lifecycle — the service guards every status write with it and the UI
 * derives its per-row status actions from the same function. Keep it pure so
 * the full matrix stays trivially unit-testable.
 */
import { z } from 'zod';

// Mirrors the `shipment_status` pg enum in src/db/schema.ts.
export const SHIPMENT_STATUSES = [
  'pending',
  'in_transit',
  'delivered',
  'delayed',
  'exception',
  'cancelled',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Legal shipment status transitions:
 *  - the happy path is pending → in_transit → delivered;
 *  - delayed/exception are reachable from pending|in_transit and can return
 *    to in_transit once resolved;
 *  - cancelled only from pending|delayed|exception (a shipment already moving
 *    can't be cancelled — it has to hit delayed/exception first);
 *  - delivered and cancelled are terminal; no self-moves.
 */
const ALLOWED_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  pending: ['in_transit', 'delayed', 'exception', 'cancelled'],
  in_transit: ['delivered', 'delayed', 'exception'],
  delayed: ['in_transit', 'cancelled'],
  exception: ['in_transit', 'cancelled'],
  delivered: [], // terminal
  cancelled: [], // terminal
};

export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return from !== to && ALLOWED_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Dates travel as YYYY-MM-DD strings (drizzle `date` column mode) — same as
// the purchase-order contract.
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

const shortText = z.string().trim().min(1).max(300);
const trackingUrl = z.string().trim().url().max(300);
const nonNegInt = z.number().int().min(0);
const currencyCode = z
  .string()
  .trim()
  .length(3, 'Expected a 3-letter currency code')
  .transform((v) => v.toUpperCase());

export const createShipmentSchema = z.object({
  supplierId: z.string().uuid(),
  /** The purchase orders (of that supplier) travelling in this shipment. */
  purchaseOrderIds: z.array(z.string().uuid()).min(1),
  nickname: shortText.optional(),
  carrier: shortText.optional(),
  trackingNumber: shortText.optional(),
  trackingUrl: trackingUrl.optional(),
  boxCount: nonNegInt.optional(),
  pieceCount: nonNegInt.optional(),
  shippingCost: z.number().min(0).optional(),
  shippingCostCurrency: currencyCode.default('USD'),
  etaDate: dateString.optional(),
  notes: z.string().max(2000).optional(),
});

/** PATCH semantics: omitted = unchanged, null = clear the field. */
export const updateShipmentSchema = z.object({
  nickname: shortText.nullable().optional(),
  carrier: shortText.nullable().optional(),
  trackingNumber: shortText.nullable().optional(),
  trackingUrl: trackingUrl.nullable().optional(),
  boxCount: nonNegInt.nullable().optional(),
  pieceCount: nonNegInt.nullable().optional(),
  shippingCost: z.number().min(0).nullable().optional(),
  // NOT NULL column with a default — settable but never clearable.
  shippingCostCurrency: currencyCode.optional(),
  etaDate: dateString.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateShipmentStatusSchema = z.object({
  status: z.enum(SHIPMENT_STATUSES),
});

export const attachPurchaseOrdersSchema = z.object({
  purchaseOrderIds: z.array(z.string().uuid()).min(1),
});

/** DELETE body for detaching a single PO from a shipment. */
export const detachPurchaseOrderSchema = z.object({
  purchaseOrderId: z.string().uuid(),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;
export type UpdateShipmentStatusInput = z.infer<typeof updateShipmentStatusSchema>;
export type AttachPurchaseOrdersInput = z.infer<typeof attachPurchaseOrdersSchema>;
export type DetachPurchaseOrderInput = z.infer<typeof detachPurchaseOrderSchema>;
