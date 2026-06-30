import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import type { SessionData } from '@/lib/session';
import { sessionOptions } from '@/lib/session';

function isAdminUiPath(pathname: string) {
  return pathname.startsWith('/admin');
}

function isAdminApiPath(pathname: string) {
  return pathname.startsWith('/api/admin');
}

function isPublicPath(pathname: string) {
  if (pathname === '/' || pathname === '/login') return true;
  if (pathname === '/login/2fa') return true;
  if (pathname.startsWith('/o/')) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname === '/api/health') return true;
  if (pathname === '/api/orders') return true;
  if (pathname === '/api/auth/accept-invite') return true;
  if (pathname === '/accept-invite') return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // Reinforce noindex on every response (PROJECT_BRIEF.md §7).
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

  const needsAuth = isAdminUiPath(pathname) || isAdminApiPath(pathname);
  const isLoginPage = pathname === '/login';
  const isTwoFactorPage = pathname === '/login/2fa';

  // Fast path — no session check needed for purely public routes.
  if (!needsAuth && !isLoginPage && !isTwoFactorPage) {
    return response;
  }

  // Read (but never write) the session in middleware.
  const cookieStore = {
    get: (name: string) => request.cookies.get(name),
    set: () => { /* no-op */ },
    delete: () => { /* no-op */ },
  };
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  // A user is fully authenticated when they have a userId AND 2FA is not pending.
  const fullyAuthed = Boolean(session.userId) && !session.mfaPending;
  const awaitingMfa = Boolean(session.userId) && session.mfaPending === true;

  // /login/2fa — only accessible when the user has a pending MFA session.
  if (isTwoFactorPage) {
    if (!session.userId) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    if (fullyAuthed) {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url));
    }
    return response; // awaitingMfa — let them through
  }

  if (needsAuth && !fullyAuthed) {
    if (isAdminApiPath(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // If they finished password auth but still need 2FA, send to the 2FA page.
    if (awaitingMfa) {
      return NextResponse.redirect(new URL('/login/2fa', request.url));
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect logged-in staff away from the login page.
  if (isLoginPage && fullyAuthed) {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url));
  }

  return response;
}

export const config = {
  // Skip Next.js internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
