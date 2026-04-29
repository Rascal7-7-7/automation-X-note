import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100') || 100, 500);

  try {
    const rows = key
      ? await sql`
          SELECT id, key, value, meta, recorded_at
          FROM metrics
          WHERE key = ${key}
          ORDER BY recorded_at DESC
          LIMIT ${limit}`
      : await sql`
          SELECT DISTINCT ON (key) id, key, value, meta, recorded_at
          FROM metrics
          ORDER BY key, recorded_at DESC
          LIMIT ${limit}`;
    return NextResponse.json({ metrics: rows });
  } catch {
    return NextResponse.json({ error: 'database error' }, { status: 503 });
  }
}
