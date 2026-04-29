import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const KEY = process.env.N8N_API_KEY ?? '';

function n8nHeaders(): Record<string, string> {
  return KEY ? { 'X-N8N-API-KEY': KEY } : {};
}

async function safeJson(url: string, opts: RequestInit = {}): Promise<{ data: unknown; status: number } | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return { data: null, status: r.status };
    const data = await r.json();
    return { data, status: r.status };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const [wf, ex] = await Promise.all([
    safeJson(`${N8N}/api/v1/workflows?limit=50`, { headers: n8nHeaders() }),
    safeJson(`${N8N}/api/v1/executions?limit=30`, { headers: n8nHeaders() }),
  ]);

  const n8nAuthError = wf?.status === 401 || wf?.status === 403
                    || ex?.status === 401 || ex?.status === 403;
  const wfData = wf?.data as { data?: unknown[] } | null;
  const exData = ex?.data as { data?: unknown[] } | null;

  return NextResponse.json({
    workflows: wfData?.data ?? [],
    executions: exData?.data ?? [],
    n8nReachable: wf !== null && !n8nAuthError,
    n8nAuthError,
  });
}
