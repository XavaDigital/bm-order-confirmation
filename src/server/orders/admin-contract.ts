import { z } from 'zod';
import { sizingRowSchema as baseSizingRowSchema, selectedValuesSchema } from './contract';

export const updateOrderSchema = z.object({
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
});

export const addGarmentSchema = z.object({
  name: z.string().min(1),
  fabrics: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  garmentTypeId: z.string().uuid().optional(),
  selectedOptions: selectedValuesSchema.optional(),
  selectedFabrics: selectedValuesSchema.optional(),
});

export const updateGarmentSchema = addGarmentSchema
  .extend({
    sizeChartIds: z.array(z.string().uuid()).optional(),
    // null clears the type and reverts the garment to the free-text workflow
    garmentTypeId: z.string().uuid().nullable().optional(),
    selectedOptions: selectedValuesSchema.nullable().optional(),
    selectedFabrics: selectedValuesSchema.nullable().optional(),
  })
  .partial();

export const sizingRowSchema = baseSizingRowSchema.extend({
  sortOrder: z.number().int().optional(),
});

export const upsertSizingSchema = z.array(sizingRowSchema);

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type AddGarmentInput = z.infer<typeof addGarmentSchema>;
export type UpdateGarmentInput = z.infer<typeof updateGarmentSchema>;
export type UpsertSizingInput = z.infer<typeof upsertSizingSchema>;
