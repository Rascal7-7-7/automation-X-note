import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const BRIDGE = process.env.BRIDGE_URL;

const ALLOWED_PATHS = new Set([
  '/api/x/process',
  '/api/note/generate',
  '/api/instagram/generate',
  '/api/ghost/generate',
  '/api/youtube/generate',
]);

export async function POST(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  if (!BRIDGE) return NextResponse.json({ error: 'BRIDGE_URL not configured' }, { status: 503 });

  const { bridgePath, ...forwardBody } = body as { bridgePath?: unknown; [k: string]: unknown };
  if (typeof bridgePath !== 'string' || !ALLOWED_PATHS.has(bridgePath)) {
    return NextResponse.json({ error: 'invalid bridgePath' }, { status: 400 });
  }

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 15_000);
    const r    = await fetch(`${BRIDGE}${bridgePath}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(forwardBody),
      signal:  ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) return NextResponse.json({ error: 'bridge error' }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'bridge unreachable' }, { status: 503 });
  }
}
