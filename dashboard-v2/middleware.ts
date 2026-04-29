import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSession } from '@/lib/session';

const SECRET = process.env.DASHBOARD_SECRET ?? '';
const LOGIN_PATH = '/login';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // auth endpoints + login page always open
  if (pathname === LOGIN_PATH || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // fail-closed: misconfigured server blocks everything
  if (!SECRET) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'server misconfigured' }, { status: 503 })
      : NextResponse.redirect(new URL(LOGIN_PATH, req.url));
  }

  const sessionId    = req.cookies.get('session_id')?.value;
  const headerSecret = req.headers.get('x-dashboard-secret') ?? '';
  // constant-time compare for edge runtime (no Node crypto available)
  const headerMatch = (() => {
    const a = new TextEncoder().encode(headerSecret);
    const b = new TextEncoder().encode(SECRET);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  })();
  const authenticated = validateSession(sessionId) || headerMatch;

  if (authenticated) return NextResponse.next();

  return pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    : NextResponse.redirect(new URL(LOGIN_PATH, req.url));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff2?|ttf)$).*)',
  ],
};
