import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const KEY = process.env.N8N_API_KEY ?? '';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'invalid workflow id' }, { status: 400 });
  }
  const { active } = await req.json() as { active: boolean };
  const endpoint = active ? 'activate' : 'deactivate';
  try {
    const r = await fetch(`${N8N}/api/v1/workflows/${id}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(KEY ? { 'X-N8N-API-KEY': KEY } : {}),
      },
    });
    if (!r.ok) return NextResponse.json({ error: 'toggle failed' }, { status: 502 });
    return NextResponse.json({ ok: true, active });
  } catch {
    return NextResponse.json({ error: 'n8n unreachable' }, { status: 503 });
  }
}
