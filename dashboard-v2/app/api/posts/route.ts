import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50') || 50, 200);

  try {
    const rows = platform
      ? await sql`
          SELECT id, platform, account, content, status, error_msg, created_at
          FROM posts
          WHERE platform = ${platform}
          ORDER BY created_at DESC
          LIMIT ${limit}`
      : await sql`
          SELECT id, platform, account, content, status, error_msg, created_at
          FROM posts
          ORDER BY created_at DESC
          LIMIT ${limit}`;
    return NextResponse.json({ posts: rows });
  } catch {
    return NextResponse.json({ error: 'database error' }, { status: 503 });
  }
}
