import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requestPasswordReset } from '@/server/users/service';
import { sendPasswordResetEmail, isEmailConfigured } from '@/lib/email';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  email: z.string().email(),
});

const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'public',
  tag: 'auth/forgot-password POST',
  schema: bodySchema,
  handler: async ({ request, body }) => {
    const ip = getClientIp(request.headers);
    const ipLimited = await rateLimitedResponse(
      `forgot-password:ip:${ip}`,
      RATE_LIMITS.credential, 'Too many requests. Please try again later.');
    if (ipLimited) return ipLimited;

    const email = body.email.toLowerCase().trim();
    const emailLimited = await rateLimitedResponse(
      `forgot-password:email:${email}`,
      RATE_LIMITS.credential, 'Too many requests. Please try again later.');
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
  },
});
