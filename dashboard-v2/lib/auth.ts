import { NextResponse } from 'next/server';

function parseCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function checkAuth(req: Request): NextResponse | null {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    return null; // dev: skip if not set
  }
  const headerSecret = req.headers.get('x-dashboard-secret');
  const cookieSecret = parseCookie(req, 'dashboard_secret');
  if (headerSecret === secret || cookieSecret === secret) return null;
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
