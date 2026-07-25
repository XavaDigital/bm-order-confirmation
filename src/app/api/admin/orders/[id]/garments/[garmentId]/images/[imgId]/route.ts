import { NextResponse } from 'next/server';
import { deleteMockupImage } from '@/server/orders/service';
import { deleteFile } from '@/lib/storage';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

export const DELETE = defineRoute<{ id: string; garmentId: string; imgId: string }>({
  auth: 'staff',
  tag: 'admin/images DELETE',
  handler: async ({ params, session }) => {
    const { storageKey } = await deleteMockupImage(params.imgId, { actorEmail: session!.email });

    // Best-effort storage delete — don't fail the request if storage is unreachable.
    deleteFile(storageKey).catch((err) =>
      logger.warn('[admin/images DELETE] storage delete failed', storageKey, err),
    );

    return NextResponse.json({ ok: true });
  },
});
