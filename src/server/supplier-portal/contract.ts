/**
 * Zod contracts for the token-gated supplier portal (SUPPLIER_PORTAL_PLAN.md).
 *
 * No session exists on this surface — every request carries the raw magic-link
 * token in the body, exactly like `/api/o/**`. `SUPPLIER_ALLOWED_STATUSES` is a
 * deliberately narrower subset of `PO_STATUSES`: a supplier can push a PO
 * forward through the shop-floor states (David's 2026-08-05 ruling: through
 * SHIPPING), but `sent` (staff re-sending), `received`/`completed` (the
 * physical-goods checkpoint — ours, not the supplier's claim), and
 * `cancelled`/`remake` (business decisions) all stay staff-only actions.
 * `confirmed` dropped out of the list with the new vocabulary: a supplier's
 * first act is now moving the PO to Design Prep, which IS the confirmation.
 */
import { z } from 'zod';

export const SUPPLIER_ALLOWED_STATUSES = [
  'pre_production',
  'test_print',
  'prod_layout',
  'in_production',
  'quality_control',
  'in_transit',
] as const;

export type SupplierAllowedStatus = (typeof SUPPLIER_ALLOWED_STATUSES)[number];

export const supplierPortalTokenSchema = z.object({
  token: z.string().min(1),
});

export const updateSupplierPoStatusSchema = z.object({
  token: z.string().min(1),
  status: z.enum(SUPPLIER_ALLOWED_STATUSES),
});

export const addSupplierCommentSchema = z.object({
  token: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

export type UpdateSupplierPoStatusInput = z.infer<typeof updateSupplierPoStatusSchema>;
export type AddSupplierCommentInput = z.infer<typeof addSupplierCommentSchema>;

// ---------------------------------------------------------------------------
// The password-gated per-supplier portal (/supplier/[code], David 2026-08-05).
// Auth rides the signed cookie (src/lib/supplier-session.ts), so these bodies
// carry no token. The person's name is captured once at login.
// ---------------------------------------------------------------------------

export const supplierLoginSchema = z.object({
  password: z.string().min(1).max(200),
  /** Self-asserted — labels comments and status changes; junk accepted by ruling. */
  name: z.string().trim().min(1).max(80),
});

/** Single or bulk — the table's row action and multi-select both post here. */
export const portalUpdateStatusSchema = z.object({
  poNumbers: z.array(z.string().min(1)).min(1).max(100),
  status: z.enum(SUPPLIER_ALLOWED_STATUSES),
});

export const portalShipDateSchema = z.object({
  poNumber: z.string().min(1),
  /** YYYY-MM-DD, same wire shape as the admin PO contract. */
  expectedShipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date'),
});

export const portalCommentSchema = z.object({
  poNumber: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

export type SupplierLoginInput = z.infer<typeof supplierLoginSchema>;
export type PortalUpdateStatusInput = z.infer<typeof portalUpdateStatusSchema>;
export type PortalShipDateInput = z.infer<typeof portalShipDateSchema>;
export type PortalCommentInput = z.infer<typeof portalCommentSchema>;
