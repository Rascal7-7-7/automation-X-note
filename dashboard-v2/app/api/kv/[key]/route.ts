import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

type Params = { params: Promise<{ key: string }> };

const ALLOWED_KEYS = new Set(['settings:bridge-url']);

export async function GET(req: Request, { params }: Params) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { key } = await params;
  if (!ALLOWED_KEYS.has(key)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const rows = await sql`SELECT data FROM kv_store WHERE key = ${key} LIMIT 1`;
  if (!rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(rows[0].data);
}

export async function POST(req: Request, { params }: Params) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { key } = await params;
  if (!ALLOWED_KEYS.has(key)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  await sql`
    INSERT INTO kv_store (key, data, updated_at)
    VALUES (${key}, ${JSON.stringify(body)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET data = EXCLUDED.data, updated_at = NOW()`;

  return NextResponse.json({ ok: true });
}
