import { NextResponse } from 'next/server';
import { redriveEvent } from '@/server/events/processor';
import { defineRoute } from '@/lib/route-handler';

/** Admin "Retry now": resets a failed/dead outbox event to pending for the next processOutbox() run. */
export const POST = defineRoute<{ id: string }>({
  auth: 'admin',
  tag: 'admin/events/retry POST',
  handler: async ({ params }) => {
    const ok = await redriveEvent(params.id);
    if (!ok) return NextResponse.json({ error: 'Event not found or not failed/dead' }, { status: 404 });
    return NextResponse.json({ ok: true });
  },
});
