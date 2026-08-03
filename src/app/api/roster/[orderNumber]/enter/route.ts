import { NextResponse } from 'next/server';
import { z } from 'zod';
import { enterRoster } from '@/server/roster/guest-service';
import { buildRosterSessionCookie } from '@/lib/roster-session';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { defineRoute } from '@/lib/route-handler';

const bodySchema = z.object({
  email: z.string().email(),
  name: z.string().trim().max(120).optional(),
  /** Required when the page has a password, unless a token link is used. */
  password: z.string().max(64).optional(),
  /** The ?t= token from a staff-shared auto-login link. */
  token: z.string().max(200).optional(),
});

/**
 * Pass the roster page's gate and become a guest: password-or-token + email →
 * signed HttpOnly session cookie. Rate-limited like every customer write —
 * this is also the password brute-force surface.
 */
export const POST = defineRoute<{ orderNumber: string }, typeof bodySchema._type>({
  auth: 'public',
  tag: 'roster/enter POST',
  schema: bodySchema,
  handler: async ({ request, params, body }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `roster-enter:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many attempts. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    try {
      const { order, guestId } = await enterRoster({
        orderNumber: params.orderNumber,
        email: body.email,
        name: body.name ?? null,
        password: body.password ?? null,
        token: body.token ?? null,
      });

      const cookie = buildRosterSessionCookie({
        orderId: order.id,
        guestId,
        rosterPassword: order.rosterPassword,
      });
      const res = NextResponse.json({ ok: true });
      res.cookies.set(cookie.name, cookie.value, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: cookie.maxAgeSeconds,
        path: '/',
      });
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      if (msg === 'roster_not_found') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (msg === 'bad_gate') {
        return NextResponse.json(
          { error: 'Incorrect password.', code: 'bad_gate' },
          { status: 403 },
        );
      }
      throw err;
    }
  },
});
