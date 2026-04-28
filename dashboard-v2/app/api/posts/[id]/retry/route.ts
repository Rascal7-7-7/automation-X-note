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

  const rows = await sql`SELECT * FROM posts WHERE id = ${numId} LIMIT 1`;
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const post = rows[0] as { platform: string; account: string | null; content: string | null };

  const endpoint: Record<string, string> = {
    x:         '/api/x/process',
    note:      '/api/note/post',
    instagram: '/api/instagram/post',
    youtube:   '/api/youtube/upload',
    ghost:     '/api/ghost/post',
  };
  const path = endpoint[post.platform];
  if (!path) return NextResponse.json({ error: 'unsupported platform' }, { status: 400 });

  try {
    const r = await fetch(`${BRIDGE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: post.account, content: post.content, retryPostId: numId }),
    });
    if (!r.ok) return NextResponse.json({ error: 'bridge error' }, { status: 502 });
    await sql`UPDATE posts SET status = 'retrying', updated_at = NOW() WHERE id = ${numId}`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'bridge unreachable' }, { status: 503 });
  }
}
