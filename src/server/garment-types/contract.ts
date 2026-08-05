/**
 * Zod contracts for the garment-type preset catalog (admin-managed).
 *
 * Shapes mirror Sales Hub's products.orderOptions / products.sizes
 * (bm-sales src/db/schema/sales.ts) for fleet parity, extended with a
 * `type: 'text'` option variant for free-text fields. Sales-Hub-shaped
 * payloads that omit `type` parse as `'select'`.
 */
import { z } from 'zod';
import type { GarmentTypeOption } from '@/db/schema';
import { uniqueBy } from '@/lib/validation';

const showWhenSchema = z.object({
  parentLabel: z.string(),
  equals: z.array(z.string()).min(1),
});

const selectOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  type: z.literal('select'),
  options: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
  defaultOption: z.string().trim().min(1).max(120).optional(),
  /** The sales person MUST answer this while it is visible (David, 2026-08-06). */
  required: z.boolean().optional(),
  showWhen: showWhenSchema.optional(),
});

const textOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  type: z.literal('text'),
  defaultValue: z.string().trim().max(300).optional(),
  required: z.boolean().optional(),
  showWhen: showWhenSchema.optional(),
});

const checkboxOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  type: z.literal('checkbox'),
  defaultValue: z.boolean().optional(),
  showWhen: showWhenSchema.optional(),
});

export const garmentTypeOptionSchema: z.ZodType<GarmentTypeOption, z.ZodTypeDef, unknown> =
  z.preprocess(
    (val) =>
      val && typeof val === 'object' && !('type' in val)
        ? { ...(val as object), type: 'select' }
        : val,
    z
      .discriminatedUnion('type', [selectOptionSchema, textOptionSchema, checkboxOptionSchema])
      .superRefine((val, ctx) => {
        if (
          val.type === 'select' &&
          val.defaultOption !== undefined &&
          !val.options.includes(val.defaultOption)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['defaultOption'],
            message: 'defaultOption must be one of the listed options',
          });
        }
      }),
  );

export type GarmentTypeOptionInput = GarmentTypeOption;

/**
 * Chain rules for `showWhen`, checked at the array level (needs sibling
 * context — an individual item can't see its neighbours). A `parentLabel`
 * must reference a PRECEDING option by index: this is the acyclic guarantee,
 * for free, without a graph check — you cannot depend on something defined
 * after you. See CHAINED_CONDITIONAL_FIELDS_PLAN.md.
 */
function checkConditionalChain(
  options: GarmentTypeOption[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
) {
  options.forEach((opt, index) => {
    if (!opt.showWhen) return;
    const parentIndex = options.findIndex((o) => o.label === opt.showWhen!.parentLabel);
    if (parentIndex === -1 || parentIndex >= index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'showWhen', 'parentLabel'],
        message: 'showWhen.parentLabel must reference an earlier option in the list',
      });
      return;
    }
    const parent = options[parentIndex];
    if (parent.type === 'text') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'showWhen', 'parentLabel'],
        message: 'showWhen cannot gate on a free-text option',
      });
      return;
    }
    const allowedValues = parent.type === 'checkbox' ? ['true', 'false'] : parent.options;
    const invalid = opt.showWhen.equals.filter((v) => !allowedValues.includes(v));
    if (invalid.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'showWhen', 'equals'],
        message:
          parent.type === 'checkbox'
            ? "showWhen.equals must be a subset of ['true', 'false'] for a checkbox parent"
            : "showWhen.equals must only contain the parent select option's values",
      });
    }
  });
}

export const fabricFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  options: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
});

const uniqueLabels = uniqueBy((o: { label: string }) => o.label.toLowerCase());

export const createGarmentTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80).nullish(),
  fabricFields: z
    .array(fabricFieldSchema)
    .max(10)
    .default([])
    .refine(uniqueLabels, { message: 'Fabric field labels must be unique' }),
  orderOptions: z
    .array(garmentTypeOptionSchema)
    .max(30)
    .default([])
    .refine(uniqueLabels, { message: 'Option labels must be unique' })
    .superRefine((options, ctx) => checkConditionalChain(options, ctx, [])),
  // Default extra columns for the sizing table of garments of this type.
  sizingColumns: z
    .array(garmentTypeOptionSchema)
    .max(20)
    .default([])
    .refine(uniqueLabels, { message: 'Sizing column labels must be unique' })
    .superRefine((options, ctx) => checkConditionalChain(options, ctx, [])),
  sizeChartIds: z.array(z.string().uuid()).max(20).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateGarmentTypeSchema = createGarmentTypeSchema.partial();

export type CreateGarmentTypeInput = z.infer<typeof createGarmentTypeSchema>;
export type UpdateGarmentTypeInput = z.infer<typeof updateGarmentTypeSchema>;
