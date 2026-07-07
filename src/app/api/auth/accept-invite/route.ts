import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { acceptInvite, InviteExpiredError } from '@/server/users/service';
import { badRequest } from '@/lib/api-responses';

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  try {
    await acceptInvite(parsed.data.token, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InviteExpiredError) {
      return NextResponse.json({ error: err.message }, { status: 410 });
    }
    console.error('[auth/accept-invite POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
