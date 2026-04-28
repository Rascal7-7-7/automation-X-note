import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const rows = await sql`
    SELECT id, platform, account, status, content, error_msg, created_at, metadata
    FROM posts
    WHERE platform = 'youtube'
    ORDER BY created_at DESC
    LIMIT 30`;

  const pipeline = rows.map(r => ({
    id:      r.id,
    type:    (r.account as string) ?? 'unknown',
    status:  r.status as string,
    title:   r.content ? (r.content as string).slice(0, 60) : '—',
    error:   r.error_msg ?? null,
    meta:    r.metadata,
    created: r.created_at,
  }));

  const byStatus = pipeline.reduce<Record<string, number>>((a, p) => {
    a[p.status] = (a[p.status] ?? 0) + 1;
    return a;
  }, {});

  return NextResponse.json({ pipeline, byStatus });
}
