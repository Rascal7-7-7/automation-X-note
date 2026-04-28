import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const KEY = process.env.N8N_API_KEY ?? '';

function n8nHeaders(): Record<string, string> {
  return KEY ? { 'X-N8N-API-KEY': KEY } : {};
}

async function safeJson(url: string, opts: RequestInit = {}) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const [workflows, executions] = await Promise.all([
    safeJson(`${N8N}/api/v1/workflows?limit=50`, { headers: n8nHeaders() }),
    safeJson(`${N8N}/api/v1/executions?limit=30`, { headers: n8nHeaders() }),
  ]);

  return NextResponse.json({
    workflows: workflows?.data ?? [],
    executions: executions?.data ?? [],
    n8nReachable: workflows !== null,
  });
}
