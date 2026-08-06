/**
 * Zod contracts for the size-chart library. Charts carry a structured,
 * ordered size list (with per-size tall availability) alongside their
 * uploaded reference file — the list drives size dropdowns in the staff
 * sizing table and the customer roster flow.
 */
import { z } from 'zod';
import { uniqueBy } from '@/lib/validation';

/**
 * Chart kind (David, 2026-08-06): 'customer' charts show on the customer
 * surfaces; 'production' charts carry the fuller factory detail and are what
 * PO/supplier surfaces prefer. Matches `SizeChartKind` in src/db/schema.ts.
 */
export const SIZE_CHART_KINDS = ['customer', 'production'] as const;
export const sizeChartKindSchema = z.enum(SIZE_CHART_KINDS);

export const sizeChartSizeSchema = z.object({
  label: z.string().trim().min(1).max(30),
  tall: z.boolean().default(false),
});

export const sizeChartSizesSchema = z
  .array(sizeChartSizeSchema)
  .max(100)
  .refine(uniqueBy((s) => s.label.toLowerCase()), { message: 'Size labels must be unique' });

/**
 * The multipart create route sends sizes as a JSON-string form field —
 * parse then validate. Missing/empty input should be handled by the caller
 * (treat as []); this schema rejects malformed JSON with a proper issue.
 */
export const sizeChartSizesFormSchema = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'sizes must be valid JSON' });
      return z.NEVER;
    }
  })
  .pipe(sizeChartSizesSchema);

export type SizeChartSizeInput = z.infer<typeof sizeChartSizeSchema>;
