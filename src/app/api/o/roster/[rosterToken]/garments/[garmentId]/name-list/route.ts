import { NextResponse } from 'next/server';
import { upsertNameListSchema } from '@/server/orders/name-list-contract';
import { ROSTER_LOCKED_MESSAGE } from '@/server/roster/contract';
import { updateGarmentNameList } from '@/server/roster/customer-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<
  { rosterToken: string; garmentId: string },
  typeof upsertNameListSchema._type
>({
  auth: 'public',
  tag: 'o/roster/[rosterToken]/garments/[garmentId]/name-list POST',
  schema: upsertNameListSchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `roster-name-list:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    try {
      const entries = await updateGarmentNameList(params.rosterToken, params.garmentId, body);
      return NextResponse.json({ ok: true, entries });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';

      if (msg === 'invalid_token' || msg === 'garment_not_found') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (msg === 'roster_locked') {
        return NextResponse.json({ error: ROSTER_LOCKED_MESSAGE, code: 'roster_locked' }, { status: 409 });
      }
      if (msg === 'name_list_full') {
        return NextResponse.json({ error: 'Name list is full', code: 'name_list_full' }, { status: 409 });
      }

      throw err;
    }
  },
});
