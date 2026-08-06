import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteMockupImage, updateMockupImageCaption } from '@/server/orders/service';
import { isMockupReferencedByAnyPoRevision } from '@/server/purchase-orders/service';
import { deleteFile } from '@/lib/storage';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

const captionSchema = z.object({
  caption: z.string().trim().max(300).nullable(),
});

export const PATCH = defineRoute<{ id: string; garmentId: string; imgId: string }, typeof captionSchema._type>({
  auth: 'staff',
  tag: 'admin/images PATCH',
  schema: captionSchema,
  handler: async ({ params, body, session }) => {
    const result = await updateMockupImageCaption(
      params.id,
      params.garmentId,
      params.imgId,
      body.caption,
      { actorEmail: session!.email },
    );
    return NextResponse.json(result);
  },
});

export const DELETE = defineRoute<{ id: string; garmentId: string; imgId: string }>({
  auth: 'staff',
  tag: 'admin/images DELETE',
  handler: async ({ params, session }) => {
    const { orderId, storageKey, thumbnailStorageKey } = await deleteMockupImage(params.imgId, {
      actorEmail: session!.email,
    });

    const isReferenced = await isMockupReferencedByAnyPoRevision(orderId, [
      storageKey,
      thumbnailStorageKey,
    ]);

    if (isReferenced) {
      logger.info('[admin/images DELETE] storage preserved for historical PO snapshot', {
        imgId: params.imgId,
        orderId,
        storageKey,
        thumbnailStorageKey,
      });
    } else {
      // Best-effort storage delete - don't fail the request if storage is unreachable.
      deleteFile(storageKey).catch((err) =>
        logger.warn('[admin/images DELETE] storage delete failed', storageKey, err),
      );
      if (thumbnailStorageKey) {
        deleteFile(thumbnailStorageKey).catch((err) =>
          logger.warn(
            '[admin/images DELETE] thumbnail storage delete failed',
            thumbnailStorageKey,
            err,
          ),
        );
      }
    }

    return NextResponse.json({ ok: true });
  },
});
