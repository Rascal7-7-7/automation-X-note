import { NextResponse } from 'next/server';

export function checkAuth(req: Request): NextResponse | null {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
    }
    return null; // dev: skip if not set
  }
  const auth = req.headers.get('x-dashboard-secret');
  if (auth !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
