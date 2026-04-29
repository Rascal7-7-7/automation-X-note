import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '50') || 50, 200);

  try {
    const rows = await sql`
      SELECT id, platform, account, content, media_url, status,
             scheduled_at, metadata, created_at
      FROM posts
      WHERE status = 'pending'
        AND (${platform}::text IS NULL OR platform = ${platform})
      ORDER BY created_at DESC
      LIMIT ${limit}`;
    return NextResponse.json({ drafts: rows });
  } catch {
    return NextResponse.json({ drafts: [] });
  }
}
