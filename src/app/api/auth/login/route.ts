import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loginStaff, AuthError } from '@/server/auth/service';
import { getSession } from '@/lib/session';
import { getClientIp, rateLimitedResponse } from '@/lib/rate-limit';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateLimited = rateLimitedResponse(`login:${ip}`, 10, 15 * 60 * 1_000, 'Too many login attempts. Please try again later.');
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

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
    console.error('[auth/login]', err);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
