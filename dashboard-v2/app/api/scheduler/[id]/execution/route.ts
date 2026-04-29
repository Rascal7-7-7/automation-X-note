import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const KEY = process.env.N8N_API_KEY ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUM_RE  = /^\d+$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  if (!UUID_RE.test(id) && !NUM_RE.test(id)) {
    return NextResponse.json({ error: 'invalid execution id' }, { status: 400 });
  }

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${N8N}/api/v1/executions/${id}?includeData=true`, {
      headers: KEY ? { 'X-N8N-API-KEY': KEY } : {},
      signal: ctrl.signal,
    });
    clearTimeout(tid);

    if (r.status === 404) return NextResponse.json({ error: 'execution not found' }, { status: 404 });
    if (!r.ok)           return NextResponse.json({ error: 'n8n error', status: r.status }, { status: 502 });

    const data = await r.json();
    return NextResponse.json({ execution: data });
  } catch {
    return NextResponse.json({ error: 'n8n unreachable' }, { status: 503 });
  }
}
