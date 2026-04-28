import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const KEY = process.env.N8N_API_KEY ?? '';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  try {
    const r = await fetch(`${N8N}/api/v1/workflows/${id}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(KEY ? { 'X-N8N-API-KEY': KEY } : {}),
      },
      body: JSON.stringify({}),
    });
    if (!r.ok) return NextResponse.json({ error: 'n8n trigger failed' }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'n8n unreachable' }, { status: 503 });
  }
}
