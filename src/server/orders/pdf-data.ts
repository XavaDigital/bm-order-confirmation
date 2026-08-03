/**
 * Confirmation-PDF enrichment (David, 2026-08-03): the PDF must carry
 * EVERYTHING the confirmation covered — mock-up images, the agreed
 * acknowledgments, the signature, the delivery address, the customer's
 * comments. This module assembles those extras from the confirmation row +
 * storage so both PDF routes (customer + admin) share one implementation.
 *
 * Posture: best-effort per asset. A missing/corrupt image or unreachable
 * storage skips that asset — it must never fail the whole PDF.
 */
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { db } from '@/db';
import { confirmations, mockupImages } from '@/db/schema';
import { getFileBuffer, isStorageConfigured } from '@/lib/storage';
import { logger } from '@/lib/logger';

export interface PdfAckItem {
  key: string;
  title: string;
  text: string;
}

export interface PdfImage {
  dataUrl: string;
  caption: string | null;
}

export interface ConfirmationPdfExtras {
  shippingAddress: Record<string, string> | null;
  shippingAddressDeferred: boolean;
  customerConcerns: string | null;
  acknowledgments: PdfAckItem[];
  signatureDataUrl: string | null;
  signatureType: 'drawn' | 'uploaded' | 'none';
  /** garmentId → images ready for react-pdf (jpeg data URIs). */
  imagesByGarment: Map<string, PdfImage[]>;
}

/** react-pdf renders png/jpeg only — normalize whatever storage holds
 *  (webp thumbnails included) to a bounded jpeg. */
async function toPdfJpeg(key: string): Promise<string | null> {
  try {
    const buf = await getFileBuffer(key);
    const jpeg = await sharp(buf)
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 75 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch (err) {
    logger.warn('[pdf-data] image skipped', { key, err });
    return null;
  }
}

export async function buildConfirmationPdfExtras(
  orderId: string,
  garmentIds: string[],
): Promise<ConfirmationPdfExtras> {
  const confirmation = await db.query.confirmations.findFirst({
    where: eq(confirmations.orderId, orderId),
  });
  // Pre-2026-07-26 snapshots used snake_case keys — read camel first, then
  // the legacy spelling. (The ack array is newer than the cutover, so it has
  // no legacy form.)
  const raw = (confirmation?.confirmedSnapshot ?? null) as Record<string, unknown> | null;
  const snapshot = raw
    ? {
        acknowledgments: raw.acknowledgments,
        shippingAddress: raw.shippingAddress ?? raw['shipping_address'] ?? null,
        shippingAddressDeferred: raw.shippingAddressDeferred === true,
        customerConcerns: raw.customerConcerns ?? raw['customer_concerns'] ?? null,
      }
    : null;

  const rawAcks = (snapshot?.acknowledgments ?? []) as Array<{
    key?: unknown;
    title?: unknown;
    text?: unknown;
  }>;
  const acknowledgments: PdfAckItem[] = Array.isArray(rawAcks)
    ? rawAcks
        .filter((a) => a && typeof a.text === 'string')
        .map((a) => ({
          key: String(a.key ?? ''),
          title: String(a.title ?? ''),
          text: String(a.text),
        }))
    : [];

  let signatureDataUrl: string | null = null;
  if (confirmation?.signatureStorageKey && isStorageConfigured()) {
    try {
      const buf = await getFileBuffer(confirmation.signatureStorageKey);
      signatureDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    } catch (err) {
      logger.warn('[pdf-data] signature skipped', err);
    }
  }

  const imagesByGarment = new Map<string, PdfImage[]>();
  if (garmentIds.length > 0 && isStorageConfigured()) {
    const rows = await db
      .select({
        garmentId: mockupImages.garmentId,
        storageKey: mockupImages.storageKey,
        thumbnailStorageKey: mockupImages.thumbnailStorageKey,
        caption: mockupImages.caption,
        sortOrder: mockupImages.sortOrder,
      })
      .from(mockupImages)
      .where(inArray(mockupImages.garmentId, garmentIds));

    for (const row of rows.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const dataUrl = await toPdfJpeg(row.thumbnailStorageKey ?? row.storageKey);
      if (!dataUrl) continue;
      const list = imagesByGarment.get(row.garmentId) ?? [];
      list.push({ dataUrl, caption: row.caption ?? null });
      imagesByGarment.set(row.garmentId, list);
    }
  }

  const address = (snapshot?.shippingAddress ?? null) as Record<string, string> | null;

  return {
    shippingAddress: address && Object.values(address).some(Boolean) ? address : null,
    shippingAddressDeferred: snapshot?.shippingAddressDeferred === true,
    customerConcerns: (snapshot?.customerConcerns as string | null | undefined) ?? null,
    acknowledgments,
    signatureDataUrl,
    signatureType: confirmation?.signatureType ?? 'none',
    imagesByGarment,
  };
}
