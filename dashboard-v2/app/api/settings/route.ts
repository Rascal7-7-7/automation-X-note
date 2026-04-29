import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const rows = await sql`SELECT value FROM settings WHERE key = 'dry_run'`;
    const raw = rows[0]?.value;
    // JSONB stores boolean true/false; also handle string 'true'
    const dryRun = raw === true || raw === 'true';
    return NextResponse.json({ dryRun });
  } catch {
    return NextResponse.json({ dryRun: true }); // safe default
  }
}

export async function POST(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  let body: { dryRun?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const dryRun = Boolean(body.dryRun);

  await sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('dry_run', ${dryRun}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()`;

  return NextResponse.json({ ok: true, dryRun });
}
