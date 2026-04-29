import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const platform   = searchParams.get('platform');
  const post_id    = searchParams.get('post_id');
  const snapshot   = searchParams.get('snapshot_at');
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '200') || 200, 1000);

  const rows = await sql`
    SELECT id, platform, post_id, account, metric_key, value, snapshot_at, recorded_at
    FROM post_metrics
    WHERE
      (${platform}::text IS NULL OR platform = ${platform})
      AND (${post_id}::text IS NULL OR post_id = ${post_id})
      AND (${snapshot}::text IS NULL OR snapshot_at = ${snapshot})
    ORDER BY recorded_at DESC
    LIMIT ${limit}`;

  return NextResponse.json({ metrics: rows });
}
