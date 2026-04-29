import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

const BRIDGE = process.env.BRIDGE_URL ?? 'http://localhost:3001';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const rows = await sql`SELECT id, platform, account, content, status FROM posts WHERE id = ${numId} LIMIT 1`;
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const post = rows[0] as {
    platform: string;
    account: string | null;
    content: string | null;
    status: string;
  };

  if (post.status !== 'failed' && post.status !== 'error') {
    return NextResponse.json({ error: 'post is not in failed state' }, { status: 409 });
  }

  const endpoint: Record<string, string> = {
    x:         '/api/x/process',
    note:      '/api/note/post',
    instagram: '/api/instagram/post',
    youtube:   '/api/youtube/upload',
    ghost:     '/api/ghost/post',
  };
  const path = endpoint[post.platform];
  if (!path) return NextResponse.json({ error: 'unsupported platform' }, { status: 400 });

  // optimistic lock: mark retrying before bridge call
  await sql`UPDATE posts SET status = 'retrying', updated_at = NOW() WHERE id = ${numId}`;

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${BRIDGE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: post.account, content: post.content, retryPostId: numId }),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!r.ok) {
      await sql`UPDATE posts SET status = 'error', updated_at = NOW() WHERE id = ${numId}`;
      return NextResponse.json({ error: 'bridge error' }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    await sql`UPDATE posts SET status = 'error', updated_at = NOW() WHERE id = ${numId}`.catch(() => {});
    return NextResponse.json({ error: 'bridge unreachable' }, { status: 503 });
  }
}
