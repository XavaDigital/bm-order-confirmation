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
  if (pathname.startsWith('/o/')) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname === '/api/health') return true;
  if (pathname === '/api/orders') return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // Reinforce noindex on every response (PROJECT_BRIEF.md §7).
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

  const needsAuth = isAdminUiPath(pathname) || isAdminApiPath(pathname);
  const isLoginPage = pathname === '/login';

  // Fast path — no session check needed for purely public routes.
  if (!needsAuth && !isLoginPage) {
    return response;
  }

  // Read (but never write) the session in middleware.
  // request.cookies is read-only, so we adapt it to the CookieStore interface.
  // The no-op `set` is fine — middleware never calls session.save().
  const cookieStore = {
    get: (name: string) => request.cookies.get(name),
    set: () => { /* no-op */ },
    delete: () => { /* no-op */ },
  };
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  const authed = Boolean(session.userId);

  if (needsAuth && !authed) {
    if (isAdminApiPath(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect logged-in staff away from the login page.
  if (isLoginPage && authed) {
    return NextResponse.redirect(new URL('/admin/dashboard', request.url));
  }

  return response;
}

export const config = {
  // Skip Next.js internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
