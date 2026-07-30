/**
 * Mock-up thumbnail generation (roadmap 7.3). Best-effort: a failure here
 * must never block an upload, since the original is what actually matters —
 * callers get `null` back and the gallery falls back to the full-size image.
 */
import sharp from 'sharp';
import { logger } from '@/lib/logger';

// Long-edge cap: comfortably covers the 160x120 (or 2x retina) grid tile the
// customer gallery renders at without shipping a multi-MB original for it.
const THUMBNAIL_MAX_DIMENSION = 480;
const THUMBNAIL_QUALITY = 72;

export async function generateThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer)
      .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: THUMBNAIL_QUALITY })
      .toBuffer();
  } catch (err) {
    logger.warn('[image-thumbnail] generation failed, falling back to original', err);
    return null;
  }
}
