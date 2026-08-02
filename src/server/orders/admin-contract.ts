import { z } from 'zod';
import { sizingRowSchema as baseSizingRowSchema, selectedValuesSchema } from './contract';
import { garmentTypeOptionSchema } from '@/server/garment-types/contract';

export const updateOrderSchema = z.object({
  /** The order's staff-facing label; null clears it. */
  name: z.string().trim().min(1).max(200).nullable().optional(),
  customerName: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
  customerContact: z.string().nullable().optional(),
  clubName: z.string().nullable().optional(),
  orderValueAmount: z.number().positive().nullable().optional(),
  orderValueCurrency: z.string().length(3).optional(),
  invoiceUrl: z.string().url().nullable().optional(),
  expectedShipDate: z.string().nullable().optional(),
  deadlineDate: z.string().nullable().optional(),
  generalNotes: z.string().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  shippingMode: z.enum(['prefilled', 'customer_entered', 'later']).optional(),
  shippingAddress: z.record(z.unknown()).nullable().optional(),
  status: z.enum(['draft', 'sent', 'viewed', 'changes_requested']).optional(),
  // Sales Hub CRM association — null unlinks
  hubCustomerId: z.string().uuid().nullable().optional(),
  hubCustomerName: z.string().min(1).nullable().optional(),
  hubContactId: z.string().uuid().nullable().optional(),
  hubContactName: z.string().min(1).nullable().optional(),
  designProjectRef: z.string().uuid().nullable().optional(),
});

export const addGarmentSchema = z.object({
  name: z.string().min(1),
  fabrics: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  garmentTypeId: z.string().uuid().optional(),
  selectedOptions: selectedValuesSchema.optional(),
  selectedFabrics: selectedValuesSchema.optional(),
  // Extra sizing-table columns; defaults from the garment type when omitted.
  sizingColumns: z.array(garmentTypeOptionSchema).max(20).optional(),
});

export const updateGarmentSchema = addGarmentSchema
  .extend({
    sizeChartIds: z.array(z.string().uuid()).optional(),
    // null clears the type and reverts the garment to the free-text workflow
    garmentTypeId: z.string().uuid().nullable().optional(),
    selectedOptions: selectedValuesSchema.nullable().optional(),
    selectedFabrics: selectedValuesSchema.nullable().optional(),
    sizingColumns: z.array(garmentTypeOptionSchema).max(20).optional(),
  })
  .partial();

export const sizingRowSchema = baseSizingRowSchema.extend({
  // Existing row id — rows that carry one are UPDATED in place (preserving the
  // UUID and any roster-member attribution); id-less rows are inserted fresh.
  // PO snapshots key on these UUIDs, so staff saves must never regenerate them.
  id: z.string().uuid().optional(),
  sortOrder: z.number().int().optional(),
});

export const upsertSizingSchema = z.array(sizingRowSchema);

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type AddGarmentInput = z.infer<typeof addGarmentSchema>;
export type UpdateGarmentInput = z.infer<typeof updateGarmentSchema>;
export type UpsertSizingInput = z.infer<typeof upsertSizingSchema>;
