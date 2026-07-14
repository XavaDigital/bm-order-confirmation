import { NextRequest, NextResponse } from 'next/server';
import { submitMemberSizesSchema } from '@/server/roster/contract';
import { submitMemberSizesByMemberToken } from '@/server/roster/customer-service';
import { badRequest } from '@/lib/api-responses';
import { getClientIp, rateLimitedResponse } from '@/lib/rate-limit';

type Params = { params: Promise<{ memberToken: string }> };

const LOCKED_MESSAGE =
  'This team roster has been locked. Please contact your BeastMode sales representative for help.';

export async function POST(request: NextRequest, { params }: Params) {
  const ip = getClientIp(request.headers);
  const rateLimited = rateLimitedResponse(
    `roster-member-submit-sizes:${ip}`,
    10,
    15 * 60 * 1_000,
    'Too many requests. Please try again later.',
  );
  if (rateLimited) return rateLimited;

  const { memberToken } = await params;
  const body = await request.json().catch(() => null);
  const parsed = submitMemberSizesSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  try {
    const member = await submitMemberSizesByMemberToken(memberToken, parsed.data);
    return NextResponse.json(member);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'error';

    if (msg === 'invalid_token') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (msg === 'roster_locked') {
      return NextResponse.json({ error: LOCKED_MESSAGE, code: 'roster_locked' }, { status: 409 });
    }
    if (msg === 'invalid_sizes') {
      return NextResponse.json({ error: 'Invalid sizing submission' }, { status: 400 });
    }

    console.error('[/api/o/roster/member/[memberToken]/sizes]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
