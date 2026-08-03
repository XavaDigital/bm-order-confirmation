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
  /** The club admin's own password (their email = the order's customer email). */
  adminPassword: z.string().min(6).max(64).optional(),
  /** First visit: the admin is CHOOSING adminPassword rather than proving it. */
  settingAdminPassword: z.boolean().optional(),
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
      const { order, guestId, role } = await enterRoster({
        orderNumber: params.orderNumber,
        email: body.email,
        name: body.name ?? null,
        password: body.password ?? null,
        token: body.token ?? null,
        adminPassword: body.adminPassword ?? null,
        settingAdminPassword: body.settingAdminPassword ?? false,
      });

      const cookie = buildRosterSessionCookie({ order, guestId, role });
      const res = NextResponse.json({ ok: true, role });
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
      // Club-admin flow: the UI reads these codes to show the right fields.
      if (msg === 'admin_password_setup_required') {
        return NextResponse.json(
          {
            error: 'You manage this order — create your manager password (6+ characters) to continue.',
            code: 'admin_password_setup_required',
          },
          { status: 409 },
        );
      }
      if (msg === 'admin_password_required') {
        return NextResponse.json(
          { error: 'Enter your manager password.', code: 'admin_password_required' },
          { status: 403 },
        );
      }
      if (msg === 'bad_admin_password') {
        return NextResponse.json(
          { error: 'Incorrect manager password.', code: 'bad_admin_password' },
          { status: 403 },
        );
      }
      throw err;
    }
  },
});
