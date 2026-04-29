import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

const ALLOWED_STATUSES = ['pending', 'approved', 'rejected', 'done', 'failed'] as const;
type AllowedStatus = typeof ALLOWED_STATUSES[number];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: { status?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const status = body.status as string;
  if (!ALLOWED_STATUSES.includes(status as AllowedStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  const published = status === 'approved' ? new Date() : null;

  const rows = await sql`
    UPDATE posts
    SET
      status       = ${status},
      updated_at   = NOW(),
      published_at = COALESCE(${published}, published_at)
    WHERE id = ${numId}
    RETURNING id, status, updated_at`;

  if (!rows.length) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, post: rows[0] });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, platform, account, content, media_url, status,
           scheduled_at, published_at, metadata, created_at, updated_at
    FROM posts WHERE id = ${numId}`;

  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ post: rows[0] });
}
