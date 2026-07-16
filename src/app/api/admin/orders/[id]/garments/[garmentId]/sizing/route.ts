import { NextRequest, NextResponse } from 'next/server';
import { upsertSizingRows } from '@/server/orders/service';
import { upsertSizingSchema } from '@/server/orders/admin-contract';
import { badRequest } from '@/lib/api-responses';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string; garmentId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { garmentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = upsertSizingSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  try {
    await upsertSizingRows(garmentId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('[admin/sizing POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
