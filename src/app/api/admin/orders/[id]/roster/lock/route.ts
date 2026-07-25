import { NextResponse } from 'next/server';
import { lockRoster, unlockRoster } from '@/server/orders/service';
import { defineRoute } from '@/lib/route-handler';

/** Lock the roster — team members can no longer submit/change their sizes. */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster/lock POST',
  handler: async ({ params, session }) => {
    await lockRoster(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});

/** Unlock the roster — reopen it for further member submissions. */
export const DELETE = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster/lock DELETE',
  handler: async ({ params, session }) => {
    await unlockRoster(params.id, { actorEmail: session!.email });
    return NextResponse.json({ ok: true });
  },
});
