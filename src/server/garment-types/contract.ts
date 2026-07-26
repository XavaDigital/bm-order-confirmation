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

const selectOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  type: z.literal('select'),
  options: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
  defaultOption: z.string().trim().min(1).max(120).optional(),
});

const textOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  type: z.literal('text'),
  defaultValue: z.string().trim().max(300).optional(),
});

export const garmentTypeOptionSchema: z.ZodType<GarmentTypeOption, z.ZodTypeDef, unknown> =
  z.preprocess(
    (val) =>
      val && typeof val === 'object' && !('type' in val)
        ? { ...(val as object), type: 'select' }
        : val,
    z
      .discriminatedUnion('type', [selectOptionSchema, textOptionSchema])
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
    .refine(uniqueLabels, { message: 'Option labels must be unique' }),
  sizeChartIds: z.array(z.string().uuid()).max(20).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateGarmentTypeSchema = createGarmentTypeSchema.partial();

export type CreateGarmentTypeInput = z.infer<typeof createGarmentTypeSchema>;
export type UpdateGarmentTypeInput = z.infer<typeof updateGarmentTypeSchema>;
