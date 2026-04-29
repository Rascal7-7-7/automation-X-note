import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const BRIDGE = process.env.BRIDGE_URL ?? 'http://localhost:3001';

export async function POST(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 8000);

  try {
    const r = await fetch(`${BRIDGE}/api/ghost/sync-affiliates`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) return NextResponse.json({ error: 'bridge error' }, { status: 503 });
    const data = await r.json() as { synced?: number };
    return NextResponse.json({ ok: true, synced: data.synced ?? 0 });
  } catch {
    clearTimeout(tid);
    return NextResponse.json({ error: 'bridge unavailable' }, { status: 503 });
  }
}
