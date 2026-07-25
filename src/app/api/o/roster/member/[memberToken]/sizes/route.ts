import { NextResponse } from 'next/server';
import { submitMemberSizesSchema, ROSTER_LOCKED_MESSAGE } from '@/server/roster/contract';
import { submitMemberSizesByMemberToken } from '@/server/roster/customer-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ memberToken: string }, typeof submitMemberSizesSchema._type>({
  auth: 'public',
  tag: 'o/roster/member/[memberToken]/sizes POST',
  schema: submitMemberSizesSchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `roster-member-submit-sizes:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    try {
      const member = await submitMemberSizesByMemberToken(params.memberToken, body);
      return NextResponse.json(member);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'error';

      if (msg === 'invalid_token') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (msg === 'roster_locked') {
        return NextResponse.json({ error: ROSTER_LOCKED_MESSAGE, code: 'roster_locked' }, { status: 409 });
      }
      if (msg === 'invalid_sizes') {
        return NextResponse.json({ error: 'Invalid sizing submission' }, { status: 400 });
      }

      throw err;
    }
  },
});
