import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);

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
}
