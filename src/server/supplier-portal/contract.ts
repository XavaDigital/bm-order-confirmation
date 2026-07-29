/**
 * Zod contracts for the token-gated supplier portal (SUPPLIER_PORTAL_PLAN.md).
 *
 * No session exists on this surface — every request carries the raw magic-link
 * token in the body, exactly like `/api/o/**`. `SUPPLIER_ALLOWED_STATUSES` is a
 * deliberately narrower subset of `PO_STATUSES`: a supplier can push a PO
 * forward through the shop-floor states, but `sent` (staff re-sending),
 * `received`/`completed` (the physical-QC checkpoint), and `cancelled`/`remake`
 * (business decisions) all stay staff-only actions. See the rationale in
 * src/server/supplier-portal/service.ts.
 */
import { z } from 'zod';

export const SUPPLIER_ALLOWED_STATUSES = [
  'confirmed',
  'pre_production',
  'in_production',
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
