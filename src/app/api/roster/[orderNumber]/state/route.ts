import { NextResponse } from 'next/server';
import { getRosterState } from '@/server/roster/guest-service';
import { defineRoute } from '@/lib/route-handler';
import { requireRosterGuest, rosterErrorResponse } from '../_shared';

/** Everything the roster page renders, for the signed-in guest. */
export const GET = defineRoute<{ orderNumber: string }>({
  auth: 'public',
  tag: 'roster/state GET',
  handler: async ({ request, params }) => {
    const gate = await requireRosterGuest(request, params.orderNumber);
    if (gate instanceof NextResponse) return gate;

    try {
      return NextResponse.json(await getRosterState(params.orderNumber, gate.guestId));
    } catch (err) {
      return rosterErrorResponse(err);
    }
  },
});
