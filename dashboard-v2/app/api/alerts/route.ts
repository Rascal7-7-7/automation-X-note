import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const { searchParams } = new URL(req.url);
  const resolved = searchParams.get('resolved') === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100') || 100, 500);

  try {
    const rows = await sql`
      SELECT id, severity, source, message, resolved, created_at
      FROM alerts
      WHERE resolved = ${resolved}
      ORDER BY created_at DESC
      LIMIT ${limit}`;
    return NextResponse.json({ alerts: rows });
  } catch {
    return NextResponse.json({ error: 'database error' }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  let body: { id?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const numId = parseInt(String(body.id ?? ''), 10);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: 'id must be a positive integer' }, { status: 400 });
  }

  try {
    await sql`UPDATE alerts SET resolved = true WHERE id = ${numId}`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'database error' }, { status: 503 });
  }
}
