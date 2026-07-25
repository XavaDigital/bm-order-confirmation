import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loginStaff, AuthError } from '@/server/auth/service';
import { getSession } from '@/lib/session';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'public',
  tag: 'auth/login POST',
  schema: bodySchema,
  handler: async ({ request, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `login:${ip}`,
      RATE_LIMITS.customerWrite, 'Too many login attempts. Please try again later.');
    if (rateLimited) return rateLimited;

    // Per-account backoff (roadmap 3.6): the IP-based limit above doesn't stop a
    // distributed guesser rotating IPs but hammering one email address. Stricter
    // window than the per-IP one since a real user retyping their own password
    // rarely needs more than a handful of tries.
    const accountRateLimited = await rateLimitedResponse(
      `login-account:${body.email.toLowerCase()}`,
      RATE_LIMITS.credential,
      'Too many login attempts for this account. Please try again later.',
    );
    if (accountRateLimited) return accountRateLimited;

    try {
      const user = await loginStaff(body.email, body.password);
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
  },
});
