import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyOrderAccessCode } from '@/server/orders/customer-service';
import { getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { buildAccessCodeCookie } from '@/lib/access-code';
import { hashToken } from '@/lib/tokens';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  token: z.string().min(1),
  code: z.string().min(1).max(32),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateLimited = await rateLimitedResponse(`verify-code:${ip}`, 10, 15 * 60 * 1_000, 'Too many attempts. Please try again later.');
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Also limit per link, so rotating IPs doesn't buy an attacker more guesses
  // at a specific order's 6-digit code.
  const tokenKey = hashToken(parsed.data.token).slice(0, 16);
  const tokenLimited = await rateLimitedResponse(`verify-code:token:${tokenKey}`, 10, 15 * 60 * 1_000, 'Too many attempts. Please try again later.');
  if (tokenLimited) return tokenLimited;

  try {
    const result = await verifyOrderAccessCode({ rawToken: parsed.data.token, code: parsed.data.code });

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
  } catch (err) {
    logger.error('[/api/o/verify-code]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
