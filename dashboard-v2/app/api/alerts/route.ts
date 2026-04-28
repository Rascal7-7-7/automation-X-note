import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const resolved = searchParams.get('resolved') === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

  const rows = await sql`
    SELECT id, severity, source, message, resolved, created_at
    FROM alerts
    WHERE resolved = ${resolved}
    ORDER BY created_at DESC
    LIMIT ${limit}`;

  return NextResponse.json({ alerts: rows });
}

export async function PATCH(req: Request) {
  const { id } = await req.json() as { id: number };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await sql`UPDATE alerts SET resolved = true WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
