import { NextResponse } from 'next/server';
import { nameListRowsSchema } from '@/server/orders/name-list-contract';
import { updateGuestGarmentNameListRows } from '@/server/roster/guest-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';
import { requireRosterGuest, rosterErrorResponse } from '../../../../_shared';

export const POST = defineRoute<
  { orderNumber: string; garmentId: string },
  typeof nameListRowsSchema._type
>({
  auth: 'public',
  tag: 'roster/garments/[garmentId]/name-list/rows POST',
  schema: nameListRowsSchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `roster-write:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    const gate = await requireRosterGuest(request, params.orderNumber);
    if (gate instanceof NextResponse) return gate;

    try {
      await updateGuestGarmentNameListRows(
        params.orderNumber,
        gate.guestId,
        gate.isAdmin,
        params.garmentId,
        body.nameListRows,
      );
      return NextResponse.json({ ok: true });
    } catch (err) {
      return rosterErrorResponse(err);
    }
  },
});
