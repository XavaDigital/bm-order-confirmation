import { NextRequest, NextResponse } from 'next/server';
import { addRosterMemberSchema } from '@/server/roster/contract';
import { addSelf } from '@/server/roster/customer-service';
import { MAX_ROSTER_MEMBERS } from '@/server/roster/service';
import { badRequest } from '@/lib/api-responses';
import { getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ rosterToken: string }> };

const LOCKED_MESSAGE =
  'This team roster has been locked. Please contact your BeastMode sales representative for help.';

export async function POST(request: NextRequest, { params }: Params) {
  const ip = getClientIp(request.headers);
  const rateLimited = await rateLimitedResponse(
    `roster-add-self:${ip}`,
    10,
    15 * 60 * 1_000,
    'Too many requests. Please try again later.',
  );
  if (rateLimited) return rateLimited;

  const { rosterToken } = await params;
  const body = await request.json().catch(() => null);
  const parsed = addRosterMemberSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  try {
    const member = await addSelf(rosterToken, parsed.data);
    return NextResponse.json(member, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error';

    if (msg === 'invalid_token') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (msg === 'roster_locked') {
      return NextResponse.json({ error: LOCKED_MESSAGE, code: 'roster_locked' }, { status: 409 });
    }
    if (msg === 'roster_full') {
      return NextResponse.json(
        { error: `This roster is full (maximum ${MAX_ROSTER_MEMBERS} members). Please contact your team manager.`, code: 'roster_full' },
        { status: 409 },
      );
    }

    logger.error('[/api/o/roster/[rosterToken]/members]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
