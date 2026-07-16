import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestPasswordReset } from '@/server/users/service';
import { sendPasswordResetEmail, isEmailConfigured } from '@/lib/email';
import { getClientIp, rateLimitedResponse } from '@/lib/rate-limit';
import { badRequest } from '@/lib/api-responses';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  email: z.string().email(),
});

const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const ipLimited = await rateLimitedResponse(`forgot-password:ip:${ip}`, 5, 15 * 60 * 1_000, 'Too many requests. Please try again later.');
  if (ipLimited) return ipLimited;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error);
  }

  const email = parsed.data.email.toLowerCase().trim();
  const emailLimited = await rateLimitedResponse(`forgot-password:email:${email}`, 5, 15 * 60 * 1_000, 'Too many requests. Please try again later.');
  if (emailLimited) return emailLimited;

  try {
    const result = await requestPasswordReset(email);

    // Always respond the same way regardless of whether the account exists —
    // never let response shape, timing, or errors reveal account existence.
    if (result && isEmailConfigured()) {
      try {
        await sendPasswordResetEmail({
          to: result.userEmail,
          toName: result.userName,
          resetUrl: result.resetUrl,
        });
      } catch (err) {
        logger.error('[auth/forgot-password] failed to send reset email', err);
      }
    }

    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  } catch (err) {
    logger.error('[auth/forgot-password POST]', err);
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }
}
