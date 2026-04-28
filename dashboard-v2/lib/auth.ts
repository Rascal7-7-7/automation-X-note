import { NextResponse } from 'next/server';

export function checkAuth(req: Request): NextResponse | null {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) return null; // dev: skip if not set
  const auth =
    req.headers.get('x-dashboard-secret') ??
    new URL(req.url).searchParams.get('secret');
  if (auth !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
