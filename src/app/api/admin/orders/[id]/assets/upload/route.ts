import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import {
  uploadFile,
  orderAssetKey,
  isStorageConfigured,
  StorageUnavailableError,
} from '@/lib/storage';
import { parseMultipartFormData, parseUploadedFile } from '@/lib/uploads';
import { assertOrderExists } from '@/server/orders/guards';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

/**
 * Validated by EXTENSION, not MIME type: browsers send fonts as
 * application/octet-stream (or font/*, or application/x-font-ttf, depending on
 * OS), and .ai arrives as application/postscript — a MIME allowlist would
 * reject legitimate files based on which machine uploaded them.
 */
const ALLOWED_EXTENSIONS = [
  // fonts — the reason this route exists
  'otf', 'ttf', 'woff', 'woff2',
  // design files
  'ai', 'eps', 'pdf', 'svg', 'png', 'jpg', 'jpeg', 'webp',
] as const;

// Design sources (.ai especially) run large; fonts are tiny.
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Upload the BYTES of an order asset and return the storage key. Deliberately
 * two-step: the client then creates or updates the asset row with this
 * `storageKey` through the existing asset routes, whose contract enforces
 * link-XOR-upload. A one-shot multipart route would need a second copy of that
 * rule for form fields.
 *
 * An uploaded file whose asset row never gets created is an orphaned object —
 * accepted, same as the pre-create mock-up flow.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/assets/upload POST',
  handler: async ({ request, params, session }) => {
    const { id: orderId } = params;

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured on this server' },
        { status: 503 },
      );
    }

    // Before touching storage: an upload against a bad order id should 404,
    // not leave an orphan under a key nothing will ever reference.
    await assertOrderExists(orderId);

    const formData = await parseMultipartFormData(request);
    if (formData instanceof NextResponse) return formData;

    const upload = await parseUploadedFile(formData, {
      allowedExtensions: ALLOWED_EXTENSIONS,
      maxBytes: MAX_BYTES,
      typeErrorMessage:
        'Only font files (OTF, TTF, WOFF, WOFF2) and design files (AI, EPS, PDF, SVG, PNG, JPG, WebP) are allowed',
    });
    if (upload instanceof NextResponse) return upload;
    const { file, buffer } = upload;

    const ext = file.name.split('.').pop()!.toLowerCase();
    const key = orderAssetKey(orderId, `${randomBytes(8).toString('hex')}.${ext}`);

    try {
      await uploadFile(key, buffer, file.type || 'application/octet-stream');

      logger.info('[admin/assets/upload]', {
        orderId,
        key,
        bytes: buffer.length,
        by: session!.email,
      });

      // The original filename rides along so the UI can prefill the asset name.
      return NextResponse.json({ storageKey: key, filename: file.name }, { status: 201 });
    } catch (err) {
      if (err instanceof StorageUnavailableError) throw err;
      logger.error('[admin/assets/upload POST]', err);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
  },
});
