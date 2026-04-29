import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const account = searchParams.get('account');

  try {
    const rows = await sql`
      SELECT
        p.id,
        LEFT(p.content, 80)                                          AS content_preview,
        p.account,
        p.created_at,
        GREATEST(
          EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0,
          0.5
        )                                                            AS hours_since,
        COALESCE(MAX(CASE WHEN pm.metric_key = 'impressions' THEN pm.value END), 0)::int AS impressions,
        COALESCE(MAX(CASE WHEN pm.metric_key = 'likes'       THEN pm.value END), 0)::int AS likes,
        COALESCE(MAX(CASE WHEN pm.metric_key = 'retweets'    THEN pm.value END), 0)::int AS retweets
      FROM posts p
      LEFT JOIN post_metrics pm
        ON pm.platform = 'x'
        AND pm.post_id  = p.id::text
        AND pm.snapshot_at = 'total'
      WHERE p.platform = 'x'
        AND p.status IN ('done', 'approved')
        AND p.created_at >= NOW() - INTERVAL '48 hours'
        AND (${account}::text IS NULL OR p.account = ${account})
      GROUP BY p.id, p.content, p.account, p.created_at
      ORDER BY p.created_at DESC
      LIMIT 20`;

    const posts = rows.map(r => {
      const imp = Number(r.impressions);
      const lk  = Number(r.likes);
      const rt  = Number(r.retweets);
      const hrs = Number(r.hours_since);
      const totalEng = imp + lk * 5 + rt * 10;
      const velocity = Number.isFinite(hrs) && hrs > 0
        ? parseFloat((totalEng / hrs).toFixed(1))
        : 0;
      return {
        id:              Number(r.id),
        content_preview: r.content_preview as string ?? '',
        account:         r.account as string | null,
        created_at:      (r.created_at as Date).toISOString(),
        hours_since:     parseFloat(Number(r.hours_since).toFixed(1)),
        impressions:     imp,
        likes:           lk,
        retweets:        rt,
        velocity,
      };
    }).sort((a, b) => b.velocity - a.velocity);

    return NextResponse.json({ posts });
  } catch (err) {
    console.error('[x/velocity]', err);
    return NextResponse.json({ error: 'query failed' }, { status: 503 });
  }
}
