import { NextRequest, NextResponse } from 'next/server';
import { deleteMockupImage, NotFoundError } from '@/server/orders/service';
import { deleteFile } from '@/lib/storage';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string; garmentId: string; imgId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { imgId } = await params;

  try {
    const { storageKey } = await deleteMockupImage(imgId);

    // Best-effort storage delete — don't fail the request if storage is unreachable.
    deleteFile(storageKey).catch((err) =>
      logger.warn('[admin/images DELETE] storage delete failed', storageKey, err),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    logger.error('[admin/images DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
