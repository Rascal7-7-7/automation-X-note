import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifySession } from './session';

export function checkAuth(req: Request): NextResponse | null {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 503 });
  }

  const headerSecret = req.headers.get('x-dashboard-secret');
  if (headerSecret !== null) {
    const a = Buffer.from(headerSecret);
    const b = Buffer.from(secret);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return null;
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cookieHeader = req.headers.get('cookie') ?? '';
  const sessionToken = cookieHeader.match(/session_id=([^;]+)/)?.[1];
  if (verifySession(sessionToken)) return null;

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
