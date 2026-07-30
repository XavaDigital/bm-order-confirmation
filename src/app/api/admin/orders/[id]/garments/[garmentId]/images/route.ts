import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { addMockupImage } from '@/server/orders/service';
import {
  uploadFile,
  getSignedUrl,
  mockupKey,
  mockupThumbnailKey,
  isStorageConfigured,
  StorageUnavailableError,
} from '@/lib/storage';
import { generateThumbnail } from '@/lib/image-thumbnail';
import { parseMultipartFormData, parseUploadedFile } from '@/lib/uploads';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const POST = defineRoute<{ id: string; garmentId: string }>({
  auth: 'staff',
  tag: 'admin/images POST',
  handler: async ({ request, params, session }) => {
    const { id: orderId, garmentId } = params;

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured on this server' },
        { status: 503 },
      );
    }

    const formData = await parseMultipartFormData(request);
    if (formData instanceof NextResponse) return formData;

    const upload = await parseUploadedFile(formData, {
      allowedTypes: ALLOWED_TYPES,
      maxBytes: MAX_BYTES,
      typeErrorMessage: 'Only JPEG, PNG, WebP and GIF images are allowed',
    });
    if (upload instanceof NextResponse) return upload;
    const { file, buffer } = upload;

    const caption = (formData.get('caption') as string | null) ?? null;
    const ext = file.name.split('.').pop() ?? 'jpg';
    const filename = `${randomBytes(8).toString('hex')}.${ext}`;
    const key = mockupKey(orderId, garmentId, filename);

    try {
      await uploadFile(key, buffer, file.type);

      // Best-effort thumbnail: a generation or upload failure here must not
      // fail the request — the gallery falls back to the full-size original.
      let thumbnailStorageKey: string | null = null;
      const thumbnail = await generateThumbnail(buffer);
      if (thumbnail) {
        const thumbKey = mockupThumbnailKey(orderId, garmentId, filename);
        try {
          await uploadFile(thumbKey, thumbnail, 'image/webp');
          thumbnailStorageKey = thumbKey;
        } catch (err) {
          logger.warn('[admin/images POST] thumbnail upload failed', err);
        }
      }

      const image = await addMockupImage(
        garmentId,
        { storageKey: key, thumbnailStorageKey, caption },
        { actorEmail: session!.email },
      );
      const url = await getSignedUrl(key, 4 * 3600); // 4-hour signed URL for immediate admin preview

      return NextResponse.json({ ...image, url }, { status: 201 });
    } catch (err) {
      // Storage misconfiguration carries an actionable message — let the
      // wrapper 503 it instead of a generic "Upload failed".
      if (err instanceof StorageUnavailableError) throw err;
      logger.error('[admin/images POST]', err);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
  },
});
