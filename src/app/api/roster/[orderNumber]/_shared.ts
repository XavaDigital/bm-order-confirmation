import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRosterPageOrder } from '@/server/roster/guest-service';
import { readRosterSessionCookie, ROSTER_SESSION_COOKIE } from '@/lib/roster-session';

/**
 * Resolve the signed-in guest for a roster-page API call, or the error
 * response that ends it. Shared by every cookie-gated roster route.
 */
export async function requireRosterGuest(
  request: NextRequest,
  orderNumber: string,
): Promise<{ guestId: string; isAdmin: boolean } | NextResponse> {
  const order = await getRosterPageOrder(orderNumber);
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const session = readRosterSessionCookie(
    order,
    request.cookies.get(ROSTER_SESSION_COOKIE)?.value ?? null,
  );
  if (!session) {
    return NextResponse.json(
      { error: 'Session expired — enter your email again.', code: 'session_expired' },
      { status: 401 },
    );
  }
  return { guestId: session.guestId, isAdmin: session.role === 'admin' };
}

/** Map guest-service thrown strings onto responses; rethrows unknown errors. */
export function rosterErrorResponse(err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : 'error';
  switch (msg) {
    case 'roster_not_found':
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    case 'bad_gate':
      return NextResponse.json(
        { error: 'Session expired — enter your email again.', code: 'session_expired' },
        { status: 401 },
      );
    case 'roster_locked':
      return NextResponse.json(
        { error: 'The roster has been locked for production. Contact your team manager.', code: 'roster_locked' },
        { status: 409 },
      );
    case 'not_your_member':
      return NextResponse.json(
        { error: 'Only the person who added a player can change them.', code: 'not_your_member' },
        { status: 403 },
      );
    case 'invalid_sizes':
      return NextResponse.json(
        { error: 'Pick a size for every garment.', code: 'invalid_sizes' },
        { status: 400 },
      );
    case 'roster_full':
      return NextResponse.json(
        { error: 'The roster is full — contact your team manager.', code: 'roster_full' },
        { status: 409 },
      );
    default:
      throw err;
  }
}
