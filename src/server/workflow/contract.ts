import { z } from 'zod';

/**
 * Zod shapes for the workflow surface.
 *
 * `boardKey` is validated as an enum rather than passed through, because it
 * selects which table a move writes to — an unchecked value there would be a
 * way to aim a move at the wrong entity type.
 */
export const boardKeySchema = z.enum(['order', 'purchase_order']);

export const moveEntitySchema = z.object({
  boardKey: boardKeySchema,
  entityId: z.string().uuid(),
  /** Target stage SLUG, not id — slugs are the stable reference. */
  toStageSlug: z.string().min(1).max(64),
});

export type MoveEntityInput = z.infer<typeof moveEntitySchema>;

/**
 * Stage config edits. Slug and board are deliberately absent: a stage's slug is
 * its stable identity and entities reference it, so renaming is done through
 * `name`. Changing the slug would orphan every row sitting in that stage.
 */
export const updateStageSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour like #4f46e5')
    .nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  warnAfterHours: z.number().int().min(1).max(8760).nullish(),
  urgentAfterHours: z.number().int().min(1).max(8760).nullish(),
  defaultConfirmationPolicy: z.enum(['any', 'all']).optional(),
});

export type UpdateStageInput = z.infer<typeof updateStageSchema>;

export const createStageSchema = z.object({
  boardKey: boardKeySchema,
  /**
   * Lower-case, underscore-separated, and immutable once created. Constrained
   * here rather than slugified silently, so the person choosing it sees exactly
   * what they are committing to.
   */
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use lower-case letters, numbers and underscores'),
  name: z.string().trim().min(1).max(80),
  /** Which enum status this stage sits under. Validated against the board. */
  statusKey: z.string().min(1).max(64),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour like #4f46e5')
    .nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  warnAfterHours: z.number().int().min(1).max(8760).nullish(),
  urgentAfterHours: z.number().int().min(1).max(8760).nullish(),
  defaultConfirmationPolicy: z.enum(['any', 'all']).default('any'),
});

export type CreateStageInput = z.infer<typeof createStageSchema>;
