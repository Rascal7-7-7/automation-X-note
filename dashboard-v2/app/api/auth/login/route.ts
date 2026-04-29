import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createSession } from '@/lib/session';

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(req: Request) {
  // rate limit: 5 attempts per IP per minute
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const rec = attempts.get(ip) ?? { count: 0, resetAt: now + 60_000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 60_000; }
  if (rec.count >= 5) {
    return NextResponse.json({ error: 'too many attempts' }, { status: 429 });
  }
  rec.count++;
  attempts.set(ip, rec);

  const { secret } = await req.json() as { secret?: string };
  const expected = process.env.DASHBOARD_SECRET ?? '';
  if (!expected) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 503 });
  }

  const a = Buffer.from(secret ?? '');
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  const sessionId = createSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
  return res;
}
