import { NextRequest, NextResponse } from 'next/server';
import { redriveEvent } from '@/server/events/processor';
import { requireAdmin } from '@/lib/session';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

/** Admin "Retry now": resets a failed/dead outbox event to pending for the next processOutbox() run. */
export async function POST(_req: NextRequest, { params }: Params) {
  const check = await requireAdmin();
  if (check.error) return check.error;

  const { id } = await params;

  try {
    const ok = await redriveEvent(id);
    if (!ok) return NextResponse.json({ error: 'Event not found or not failed/dead' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('[admin/events/retry POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
