import { type NextRequest, NextResponse } from 'next/server';
import { adminPassword, SESSION_COOKIE, verifySessionToken } from '@/lib/session';

/**
 * First filter for the admin surface: signed-out requests never reach a protected page or
 * route. Not the only check: pages and route handlers verify the session again (lib/auth.ts),
 * as Next's guidance recommends, so a matcher gap can't expose anything.
 */
export function proxy(request: NextRequest) {
  const password = adminPassword();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (password && verifySessionToken(token, password)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized', issues: [] }, { status: 401 });
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/control/:path*', '/admin/:path*', '/api/generator/:path*', '/api/contestants/:path*'],
};
