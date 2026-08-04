import { NextResponse } from 'next/server';
import { nameListRowsSchema } from '@/server/orders/name-list-contract';
import { ROSTER_LOCKED_MESSAGE } from '@/server/roster/contract';
import { updateGarmentNameListRows } from '@/server/roster/customer-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<
  { rosterToken: string; garmentId: string },
  typeof nameListRowsSchema._type
>({
  auth: 'public',
  tag: 'o/roster/[rosterToken]/garments/[garmentId]/name-list/rows POST',
  schema: nameListRowsSchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `roster-name-list:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    try {
      await updateGarmentNameListRows(params.rosterToken, params.garmentId, body.nameListRows);
      return NextResponse.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';

      if (msg === 'invalid_token' || msg === 'garment_not_found') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (msg === 'roster_locked') {
        return NextResponse.json({ error: ROSTER_LOCKED_MESSAGE, code: 'roster_locked' }, { status: 409 });
      }

      throw err;
    }
  },
});
