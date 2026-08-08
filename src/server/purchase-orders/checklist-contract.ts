/**
 * Zod shapes for configuring the PO pre-send checklist (David, 2026-08-06).
 *
 * They live beside the service rather than in the route files because both the
 * collection route and the per-item route need them, and a Next `route.ts` may
 * only export HTTP methods and the framework's own config fields — an extra
 * export there fails the generated route validator at build time.
 */
import { z } from 'zod';

/**
 * Code vocabulary: each rule has a hard-wired evaluator in checklist-service.
 *
 * THE list, not a copy of it — `PoChecklistAutoRule` is derived from this, so a
 * new rule cannot be added to the evaluator and forgotten here. It had already
 * drifted: eight rules existed and this schema still named two, which meant the
 * admin API refused to set any of the others.
 */
export const AUTO_RULES = [
  'design_file_attached',
  'font_file_attached',
  'color_book_set',
  'customer_confirmed_current_version',
  'garment_images_all',
  'garment_size_charts_all',
  'garment_fabrics_all',
  'garment_required_options_all',
  'expected_ship_date_set',
  'customer_deadline_set',
] as const;

export const autoRuleSchema = z.enum(AUTO_RULES);

export type PoChecklistAutoRule = (typeof AUTO_RULES)[number];

/** The explanation under the title — short titles keep the list scannable. */
const descriptionSchema = z.string().trim().max(500).nullish();

export const createChecklistItemSchema = z.object({
  label: z.string().trim().min(1).max(200),
  description: descriptionSchema,
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
    description: z.string().trim().max(500).nullable(),
    autoRule: autoRuleSchema.nullable(),
    allowSidestep: z.boolean(),
    sortOrder: z.number().int().min(0).max(9999),
    isActive: z.boolean(),
  })
  .partial();
