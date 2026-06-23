import { NextResponse } from 'next/server';

// Reinforce noindex on every response, including API routes (PROJECT_BRIEF.md §7).
// next.config.mjs sets this header too; the middleware guarantees coverage for
// routes that bypass the static headers config.
export function middleware() {
  const res = NextResponse.next();
  res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res;
}

export const config = {
  matcher: '/:path*',
};
