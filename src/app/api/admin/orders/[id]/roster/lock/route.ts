import { NextRequest, NextResponse } from 'next/server';
import { lockRoster, unlockRoster, NotFoundError } from '@/server/orders/service';
import { getSession } from '@/lib/session';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

/** Lock the roster — team members can no longer submit/change their sizes. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const session = await getSession();
    await lockRoster(orderId, { actorEmail: session.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    logger.error('[admin/roster/lock POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Unlock the roster — reopen it for further member submissions. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id: orderId } = await params;
  try {
    const session = await getSession();
    await unlockRoster(orderId, { actorEmail: session.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    logger.error('[admin/roster/lock DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
