import { NextResponse } from 'next/server';
import { upsertNameListSchema } from '@/server/orders/name-list-contract';
import { updateGuestGarmentNameList } from '@/server/roster/guest-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';
import { requireRosterGuest, rosterErrorResponse } from '../../../_shared';

export const POST = defineRoute<
  { orderNumber: string; garmentId: string },
  typeof upsertNameListSchema._type
>({
  auth: 'public',
  tag: 'roster/garments/[garmentId]/name-list POST',
  schema: upsertNameListSchema,
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
      const entries = await updateGuestGarmentNameList(
        params.orderNumber,
        gate.guestId,
        gate.isAdmin,
        params.garmentId,
        body,
      );
      return NextResponse.json({ ok: true, entries });
    } catch (err) {
      return rosterErrorResponse(err);
    }
  },
});
