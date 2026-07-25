import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyOrderAccessCode } from '@/server/orders/customer-service';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { buildAccessCodeCookie } from '@/lib/access-code';
import { hashToken } from '@/lib/tokens';
import { env } from '@/lib/env';
import { defineRoute } from '@/lib/route-handler';

const bodySchema = z.object({
  token: z.string().min(1),
  code: z.string().min(1).max(32),
});

export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'public',
  tag: 'o/verify-code POST',
  schema: bodySchema,
  handler: async ({ request, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `verify-code:${ip}`,
      RATE_LIMITS.customerWrite, 'Too many attempts. Please try again later.');
    if (rateLimited) return rateLimited;

    // Also limit per link, so rotating IPs doesn't buy an attacker more guesses
    // at a specific order's 6-digit code.
    const tokenKey = hashToken(body.token).slice(0, 16);
    const tokenLimited = await rateLimitedResponse(
      `verify-code:token:${tokenKey}`,
      RATE_LIMITS.customerWrite, 'Too many attempts. Please try again later.');
    if (tokenLimited) return tokenLimited;

    const result = await verifyOrderAccessCode({ rawToken: body.token, code: body.code });

    // Generic 404 — never reveal whether a token is invalid, expired, or revoked.
    if (result.status === 'invalid_token') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.status === 'wrong_code') {
      return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    if (result.access.accessCodeHash) {
      const cookie = buildAccessCodeCookie({ id: result.access.id, accessCodeHash: result.access.accessCodeHash });
      res.cookies.set(cookie.name, cookie.value, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: cookie.maxAgeSeconds,
      });
    }
    return res;
  },
});
