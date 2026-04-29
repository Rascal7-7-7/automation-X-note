import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { secret } = await req.json() as { secret?: string };
  const expected = process.env.DASHBOARD_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set('dashboard_secret', expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
  return res;
}
