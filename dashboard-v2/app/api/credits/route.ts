import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const BRIDGE = process.env.BRIDGE_URL ?? 'http://localhost:3001';

async function safeGet(url: string) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

interface ProviderCredit { remaining?: number; total?: number }

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const status = await safeGet(`${BRIDGE}/api/analytics/status`);
  const anthropic = (status?.anthropic ?? null) as ProviderCredit | null;
  const remaining = typeof anthropic?.remaining === 'number' ? anthropic.remaining : null;

  return NextResponse.json({
    anthropic,
    fal:    status?.fal    ?? null,
    openai: status?.openai ?? null,
    ts:     new Date().toISOString(),
    warnLow: remaining !== null && remaining < 1000,
  });
}
