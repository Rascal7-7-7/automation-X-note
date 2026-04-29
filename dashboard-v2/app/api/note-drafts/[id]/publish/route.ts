import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';

const BRIDGE = process.env.BRIDGE_URL ?? 'http://localhost:3001';

// draftId = filename without .json. Allow alphanumeric, hyphens, underscores, CJK chars.
const DRAFT_ID_RE = /^[\w　-鿿！-￮-]+$/u;

// account → n8n accountId mapping (mirrors note/post.js getAccountPaths)
function accountToId(account: string): number {
  if (account === 'account2') return 2;
  if (account === 'account3') return 3;
  return 1;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  if (!DRAFT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid draft id' }, { status: 400 });
  }

  let body: { account?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const accountId = accountToId(body.account ?? 'account1');

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 300_000); // 5 min — Playwright is slow
    const r = await fetch(`${BRIDGE}/api/note/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: id, accountId }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);

    const data = await r.json() as { ok?: boolean; publishedUrl?: string; error?: string };
    if (!r.ok || !data.ok) {
      return NextResponse.json(
        { error: data.error ?? `bridge error ${r.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, publishedUrl: data.publishedUrl ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('abort')) {
      return NextResponse.json({ error: 'publish timed out (5 min)' }, { status: 504 });
    }
    return NextResponse.json({ error: 'bridge unreachable' }, { status: 503 });
  }
}
