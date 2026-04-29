import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SECRET = process.env.DASHBOARD_SECRET ?? '';
const LOGIN_PATH = '/login';
// These paths must be reachable before authentication
const PUBLIC_PATHS = new Set([LOGIN_PATH, '/api/auth/login', '/api/auth/logout']);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    const cookieSecret = req.cookies.get('dashboard_secret')?.value;
    const headerSecret = req.headers.get('x-dashboard-secret');
    if (!SECRET || cookieSecret === SECRET || headerSecret === SECRET) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cookieSecret = req.cookies.get('dashboard_secret')?.value;
  if (!SECRET || cookieSecret === SECRET) return NextResponse.next();
  return NextResponse.redirect(new URL(LOGIN_PATH, req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
