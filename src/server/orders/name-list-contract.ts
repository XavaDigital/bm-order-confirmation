/**
 * "Got Your Back" style name list — a garment-level list of names printed on
 * one shared design (GOT_YOUR_BACK_PLAN.md). Deliberately separate from the
 * sizing-row contract: entries here carry no size/quantity and must never be
 * summed into purchase-order math (see garmentNameListEntries in schema.ts).
 *
 * Used by both the admin garment editor and the customer/manager roster page
 * — same "one Zod contract, two callers" convention as orders/contract.ts vs
 * admin-contract.ts.
 */
import { z } from 'zod';

export const nameListEntrySchema = z.object({
  // Existing row id — rows that carry one are UPDATED in place; id-less rows
  // are inserted fresh. Same reconciling-upsert convention as sizingRowSchema.
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  playerNumber: z.string().trim().max(20).optional(),
  sortOrder: z.number().int().optional(),
});

// Hard input-size cap (payload safety) — the product-facing cap on how many
// names a single garment may carry is MAX_NAME_LIST_ENTRIES in
// src/server/orders/service.ts, enforced against the stored count.
export const upsertNameListSchema = z.array(nameListEntrySchema).max(300);

export const nameListRowsSchema = z.object({
  nameListRows: z.number().int().min(1).max(100).nullable(),
});

export type NameListEntryInput = z.infer<typeof nameListEntrySchema>;
export type UpsertNameListInput = z.infer<typeof upsertNameListSchema>;
