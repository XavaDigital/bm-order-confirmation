/**
 * Zod shapes for configuring the PO pre-send checklist (David, 2026-08-06).
 *
 * They live beside the service rather than in the route files because both the
 * collection route and the per-item route need them, and a Next `route.ts` may
 * only export HTTP methods and the framework's own config fields — an extra
 * export there fails the generated route validator at build time.
 */
import { z } from 'zod';

/** Code vocabulary: each rule has a hard-wired evaluator in checklist-service. */
export const autoRuleSchema = z.enum(['design_file_attached', 'color_book_set']);

export const createChecklistItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
  autoRule: autoRuleSchema.nullish(),
  allowSidestep: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

/**
 * Patch-style: only the keys sent are changed. `isActive: false` is the ONLY
 * removal — there is no DELETE, because completions and audit rows point here.
 */
export const updateChecklistItemSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    autoRule: autoRuleSchema.nullable(),
    allowSidestep: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
    isActive: z.boolean(),
  })
  .partial();
