/**
 * Zod contracts for order assets — design and font files on an order.
 *
 * A file is EITHER a link (a Drive URL staff already have) OR an upload (a
 * storageKey from src/lib/storage.ts). Never both: two sources of truth for the
 * same file means the PDF and the admin UI can disagree about which one the
 * factory got. The database enforces the same rule as a check constraint
 * (`order_assets_url_xor_storage_key`, migration 0027).
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

/** Set by the upload route after the bytes are in storage — never client-chosen. */
const assetStorageKey = z.string().trim().min(1).max(500);

/**
 * What this file is FOR on a garment: 'playerName', 'playerNumber', or the label
 * of one of the garment's user-defined sizing columns ('Secondary Name').
 *
 * Free text rather than an enum because the fields it names are themselves
 * user-defined per garment type — a closed list here goes stale the moment
 * someone adds a column. Null means the file is not tied to one text field: a
 * design file, or a font used throughout.
 */
const assetUsage = z.string().trim().min(1).max(120).nullish();

/** A link or an upload, never both and never neither. */
const exactlyOneSource = <T extends { url?: unknown; storageKey?: unknown }>(value: T) =>
  (value.url == null) !== (value.storageKey == null);

const SOURCE_MESSAGE = 'Give the file either a link or an uploaded file, not both';

export const createOrderAssetSchema = z
  .object({
    kind: z.enum(ORDER_ASSET_KINDS),
    name: z.string().trim().min(1, 'Give the file a name').max(200),
    usage: assetUsage,
    url: assetUrl.nullish(),
    storageKey: assetStorageKey.nullish(),
    notes: z.string().trim().max(1000).nullish(),
    /** Tag to a garment, or null/omitted for an order-wide file. */
    garmentId: z.string().uuid().nullish(),
    includeOnPo: z.boolean().optional().default(false),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine(exactlyOneSource, { message: SOURCE_MESSAGE, path: ['url'] });

/**
 * Update is NOT `.partial()` over the create shape, because the xor has to hold
 * on the RESULT of the patch rather than on the patch itself. Swapping a link
 * for an upload means sending both `url: null` and the new `storageKey`, so the
 * check runs only when at least one of the two is being touched.
 */
export const updateOrderAssetSchema = z
  .object({
    kind: z.enum(ORDER_ASSET_KINDS).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    usage: assetUsage,
    url: assetUrl.nullable().optional(),
    storageKey: assetStorageKey.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    garmentId: z.string().uuid().nullable().optional(),
    includeOnPo: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine(
    (value) => {
      const touchesSource = value.url !== undefined || value.storageKey !== undefined;
      if (!touchesSource) return true;
      // Both keys present in the patch → the xor must hold outright.
      if (value.url !== undefined && value.storageKey !== undefined) {
        return exactlyOneSource(value);
      }
      // Only one side is being set. Clearing the only source is refused here;
      // setting one while the other still holds a value is caught in the
      // service, which can see the stored row.
      return (value.url ?? value.storageKey) != null;
    },
    { message: SOURCE_MESSAGE, path: ['url'] },
  );

export type CreateOrderAssetInput = z.infer<typeof createOrderAssetSchema>;
export type UpdateOrderAssetInput = z.infer<typeof updateOrderAssetSchema>;
