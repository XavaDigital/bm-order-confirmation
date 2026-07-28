import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loginWithIdentity, IdentityAuthError } from '@/server/auth/service';
import { isIdentityConfigured } from '@/server/identity/client';
import { getSession } from '@/lib/session';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { serviceUnavailable } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  /** The Google ID token from Google Identity Services. */
  credential: z.string().min(1).max(4096),
});

/**
 * Sign in with Google, via the fleet identity service.
 *
 * Rate-limited per IP like the password route. There is deliberately no
 * per-account limit here: the account is not known until AFTER the credential
 * has been verified, and a forged Google ID token is not a guessable secret in
 * the way a password is.
 */
export const POST = defineRoute<Record<string, never>, typeof bodySchema._type>({
  auth: 'public',
  tag: 'auth/google POST',
  schema: bodySchema,
  handler: async ({ request, body }) => {
    if (!isIdentityConfigured()) {
      return serviceUnavailable('Google sign-in is not enabled on this server.');
    }

    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `google-login:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many sign-in attempts. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    try {
      const user = await loginWithIdentity(body.credential);
      const session = await getSession();
      session.userId = user.id;
      session.email = user.email;
      session.name = user.name;
      session.role = user.role;
      // Google has already verified the person; a second factor would be asking
      // them to prove the same thing twice.
      session.mfaPending = false;
      await session.save();

      return NextResponse.json({
        ok: true,
        user: { name: user.name, email: user.email, role: user.role },
      });
    } catch (err) {
      if (err instanceof IdentityAuthError) {
        // 403 for "known person, no grant" so the UI can tell them to ask for
        // access rather than to check their password.
        const status = err.reason === 'no_app_access' || err.reason === 'disabled' ? 403 : 401;
        return NextResponse.json({ error: err.message, reason: err.reason }, { status });
      }
      logger.error('[auth/google]', err);
      return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
    }
  },
});
