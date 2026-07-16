import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loginStaff, AuthError } from '@/server/auth/service';
import { getSession } from '@/lib/session';
import { getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateLimited = await rateLimitedResponse(`login:${ip}`, 10, 15 * 60 * 1_000, 'Too many login attempts. Please try again later.');
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Per-account backoff (roadmap 3.6): the IP-based limit above doesn't stop a
  // distributed guesser rotating IPs but hammering one email address. Stricter
  // window than the per-IP one since a real user retyping their own password
  // rarely needs more than a handful of tries.
  const accountRateLimited = await rateLimitedResponse(
    `login-account:${parsed.data.email.toLowerCase()}`,
    5,
    15 * 60 * 1_000,
    'Too many login attempts for this account. Please try again later.',
  );
  if (accountRateLimited) return accountRateLimited;

  try {
    const user = await loginStaff(parsed.data.email, parsed.data.password);
    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    session.name = user.name;
    session.role = user.role;

    if (user.requiresMfa) {
      // Credentials verified but 2FA still required — mark pending so the
      // middleware blocks admin routes until TOTP is confirmed.
      session.mfaPending = true;
      await session.save();
      return NextResponse.json({ ok: true, requiresMfa: true });
    }

    session.mfaPending = false;
    await session.save();
    return NextResponse.json({ ok: true, requiresMfa: false, user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    logger.error('[auth/login]', err);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
