import { z } from 'zod';

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
  shippingMode: z.enum(['prefilled', 'customer_entered', 'later']).optional(),
  shippingAddress: z.unknown().nullable().optional(),
  status: z.enum(['draft', 'sent', 'viewed', 'confirmed', 'changes_requested']).optional(),
});

export const addGarmentSchema = z.object({
  name: z.string().min(1),
  fabrics: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const updateGarmentSchema = addGarmentSchema
  .extend({ sizeChartIds: z.array(z.string().uuid()).optional() })
  .partial();

export const sizingRowSchema = z.object({
  size: z.string().nullable().optional(),
  playerName: z.string().nullable().optional(),
  playerNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const upsertSizingSchema = z.array(sizingRowSchema);

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type AddGarmentInput = z.infer<typeof addGarmentSchema>;
export type UpdateGarmentInput = z.infer<typeof updateGarmentSchema>;
export type UpsertSizingInput = z.infer<typeof upsertSizingSchema>;
