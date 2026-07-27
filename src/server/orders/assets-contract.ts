/**
 * Zod contracts for order assets — named links to design and font files.
 *
 * Links, not uploads: these are Drive URLs staff already have. Uploads would go
 * through src/lib/storage.ts and store a storageKey instead.
 */
import { z } from 'zod';

export const ORDER_ASSET_KINDS = ['design', 'font', 'other'] as const;

/**
 * Only http(s). A `javascript:` or `data:` URL here would be rendered as a link
 * in the admin UI and in the supplier PDF, so the scheme is an allowlist.
 */
const assetUrl = z
  .string()
  .trim()
  .min(1, 'Add a link')
  .max(2000)
  .url('Enter a full URL, e.g. https://drive.google.com/…')
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'Only http(s) links are allowed',
  });

export const createOrderAssetSchema = z.object({
  kind: z.enum(ORDER_ASSET_KINDS),
  name: z.string().trim().min(1, 'Give the file a name').max(200),
  url: assetUrl,
  notes: z.string().trim().max(1000).nullish(),
  /** Tag to a garment, or null/omitted for an order-wide file. */
  garmentId: z.string().uuid().nullish(),
  includeOnPo: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateOrderAssetSchema = z.object({
  kind: z.enum(ORDER_ASSET_KINDS).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  url: assetUrl.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  garmentId: z.string().uuid().nullable().optional(),
  includeOnPo: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type CreateOrderAssetInput = z.infer<typeof createOrderAssetSchema>;
export type UpdateOrderAssetInput = z.infer<typeof updateOrderAssetSchema>;
