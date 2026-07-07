import { getIronSession } from 'iron-session';
import type { SessionOptions } from 'iron-session';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export interface SessionData {
  userId: string;
  email: string;
  name: string;
  role: 'sales' | 'admin';
  // True when the user completed password auth but hasn't verified their TOTP code yet.
  // Protected admin routes are blocked until this is cleared.
  mfaPending?: boolean;
}

export const sessionOptions: SessionOptions = {
  password: env.SESSION_SECRET,
  cookieName: 'bm-session',
  cookieOptions: {
    secure: env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
};

/** For use in Route Handlers and Server Components (not middleware). */
export async function getSession() {
  // Lazy import so this file stays Edge-safe when imported for sessionOptions only.
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/** Guards a Route Handler to admin-only staff. Returns `{ error }` to short-circuit, or `{ session }`. */
export async function requireAdmin() {
  const session = await getSession();
  if (!session.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { session };
}
