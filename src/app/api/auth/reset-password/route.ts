import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resetPassword, ResetTokenExpiredError } from '@/server/users/service';
import { badRequest } from '@/lib/api-responses';
import { logger } from '@/lib/logger';

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
    await resetPassword(parsed.data.token, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ResetTokenExpiredError) {
      return NextResponse.json({ error: err.message }, { status: 410 });
    }
    logger.error('[auth/reset-password POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
