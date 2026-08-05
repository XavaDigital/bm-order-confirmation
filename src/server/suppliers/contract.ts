/**
 * Zod contracts for the supplier directory (admin-managed reference data).
 *
 * Suppliers are factory partners referenced by purchase orders (PO_PLAN).
 * `supplierCode` is the short uppercase code embedded in PO numbers
 * (PO-{YYMM}-{CODE}{NN}-…) — unique when set; when blank, PO numbering falls
 * back to an auto 2-char code derived from the name (see
 * `supplierCodeOrFallback` in ./service).
 */
import { z } from 'zod';

// Trim + uppercase, then validate: 1-3 chars, letters/digits only.
const supplierCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z
      .string()
      .min(1)
      .max(3)
      .regex(/^[A-Z0-9]+$/, 'Supplier code must be 1-3 letters or digits'),
  );

const nameSchema = z.string().trim().min(1).max(200);
const shortTextSchema = z.string().trim().min(1).max(200);
const emailSchema = z.string().trim().email().max(200);
const notesSchema = z.string().trim().min(1).max(2000);
const specialtiesSchema = z.array(z.string().trim().min(1).max(80)).max(20);
const nonNegIntSchema = z.number().int().min(0);

// The supplier-portal password (David, 2026-08-05): admin-set, one per
// supplier, stored READABLY (staff tell the supplier what it is — the
// rosterPassword/accessCode ruling). Setting it opens /supplier/{CODE};
// clearing it closes the portal and invalidates every session cookie.
const portalPasswordSchema = z.string().trim().min(6).max(64);

export const createSupplierSchema = z.object({
  name: nameSchema,
  supplierCode: supplierCodeSchema.optional(),
  portalPassword: portalPasswordSchema.optional(),
  contactPerson: shortTextSchema.optional(),
  email: emailSchema.optional(),
  phone: shortTextSchema.optional(),
  website: shortTextSchema.optional(),
  address: z.record(z.unknown()).optional(),
  specialties: specialtiesSchema.default([]),
  minimumOrderQuantity: nonNegIntSchema.optional(),
  leadTimeWeeks: nonNegIntSchema.optional(),
  notes: notesSchema.optional(),
  isActive: z.boolean().default(true),
});

// PATCH semantics: omitted = unchanged, null = clear the field (where the
// column is nullable and clearing makes sense). `name`/`isActive` can change
// but never be cleared.
export const updateSupplierSchema = z
  .object({
    name: nameSchema,
    supplierCode: supplierCodeSchema.nullable(),
    portalPassword: portalPasswordSchema.nullable(),
    contactPerson: shortTextSchema.nullable(),
    email: emailSchema.nullable(),
    phone: shortTextSchema.nullable(),
    website: shortTextSchema.nullable(),
    address: z.record(z.unknown()).nullable(),
    specialties: specialtiesSchema,
    minimumOrderQuantity: nonNegIntSchema.nullable(),
    leadTimeWeeks: nonNegIntSchema.nullable(),
    notes: notesSchema.nullable(),
    isActive: z.boolean(),
  })
  .partial();

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
