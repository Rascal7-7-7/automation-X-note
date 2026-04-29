import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function POST(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  let body: { id?: unknown; action?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const { id, action } = body;

  if (!id || !['approved', 'rejected'].includes(action as string)) {
    return NextResponse.json({ error: 'id and action (approved|rejected) required' }, { status: 400 });
  }

  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const rows = await sql`
    UPDATE posts
    SET status = ${action as string}, updated_at = NOW()
    WHERE id = ${numId} AND status = 'pending'
    RETURNING id`;

  if (!rows.length) return NextResponse.json({ error: 'post not found or not pending' }, { status: 409 });

  return NextResponse.json({ ok: true });
}
