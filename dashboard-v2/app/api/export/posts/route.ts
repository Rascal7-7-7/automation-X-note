import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const days = Math.min(parseInt(searchParams.get('days') ?? '30') || 30, 180);

  try {
    const rows = platform
      ? await sql`
          SELECT id, platform, account, content, status, error_msg, created_at
          FROM posts
          WHERE platform = ${platform}
            AND created_at > NOW() - (${days} * INTERVAL '1 day')
          ORDER BY created_at DESC
          LIMIT 5000`
      : await sql`
          SELECT id, platform, account, content, status, error_msg, created_at
          FROM posts
          WHERE created_at > NOW() - (${days} * INTERVAL '1 day')
          ORDER BY created_at DESC
          LIMIT 5000`;

    const header = 'id,platform,account,status,error_msg,created_at,content';
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header,
      ...rows.map(r =>
        [r.id, r.platform, r.account, r.status, r.error_msg, r.created_at, r.content]
          .map(escape).join(',')
      ),
    ];

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="posts-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error('[export/posts]', err);
    return NextResponse.json({ error: 'export failed' }, { status: 503 });
  }
}
