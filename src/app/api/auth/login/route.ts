import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loginStaff, AuthError } from '@/server/auth/service';
import { getSession } from '@/lib/session';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1_000)) },
      },
    );
  }

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
    await session.save();

    return NextResponse.json({ ok: true, user: { name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error('[auth/login]', err);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
