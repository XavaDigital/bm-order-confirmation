import { NextResponse } from 'next/server';
import { addRosterMemberSchema, ROSTER_LOCKED_MESSAGE } from '@/server/roster/contract';
import { addSelf } from '@/server/roster/customer-service';
import { MAX_ROSTER_MEMBERS } from '@/server/roster/service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ rosterToken: string }, typeof addRosterMemberSchema._type>({
  auth: 'public',
  tag: 'o/roster/[rosterToken]/members POST',
  schema: addRosterMemberSchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `roster-add-self:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    try {
      const member = await addSelf(params.rosterToken, body);
      return NextResponse.json(member, { status: 201 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';

      if (msg === 'invalid_token') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (msg === 'roster_locked') {
        return NextResponse.json({ error: ROSTER_LOCKED_MESSAGE, code: 'roster_locked' }, { status: 409 });
      }
      if (msg === 'roster_full') {
        return NextResponse.json(
          { error: `This roster is full (maximum ${MAX_ROSTER_MEMBERS} members). Please contact your team manager.`, code: 'roster_full' },
          { status: 409 },
        );
      }

      throw err;
    }
  },
});
