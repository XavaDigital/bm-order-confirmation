import { NextResponse } from 'next/server';
import { importGuestGarmentNameListFromRoster } from '@/server/roster/guest-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';
import { requireRosterGuest, rosterErrorResponse } from '../../../../_shared';

export const POST = defineRoute<{ orderNumber: string; garmentId: string }>({
  auth: 'public',
  tag: 'roster/garments/[garmentId]/name-list/import POST',
  handler: async ({ request, params }) => {
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
      const result = await importGuestGarmentNameListFromRoster(
        params.orderNumber,
        gate.guestId,
        gate.isAdmin,
        params.garmentId,
      );
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      return rosterErrorResponse(err);
    }
  },
});
