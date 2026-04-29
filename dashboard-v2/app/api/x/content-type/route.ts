import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const account = searchParams.get('account');

  try {
    // Time-proximity join: match post_metrics recorded within 48h of post publication
    // for the same platform+account. Approximation — best effort without tweet_id in posts table.
    const rows = await sql`
      SELECT
        content_type,
        COUNT(*)::int                       AS post_count,
        ROUND(AVG(impressions))::int        AS avg_impressions,
        ROUND(AVG(er_pct), 1)              AS avg_er_pct
      FROM (
        SELECT
          p.id,
          CASE
            WHEN p.content ~* '(note|記事)'          THEN '告知型'
            WHEN p.content ~* '(万円|達成|収益)'      THEN '実績型'
            ELSE '有益情報型'
          END AS content_type,
          MAX(CASE WHEN pm.metric_key = 'impressions' THEN pm.value END)  AS impressions,
          CASE
            WHEN MAX(CASE WHEN pm.metric_key = 'impressions' THEN pm.value END) > 0
            THEN MAX(CASE WHEN pm.metric_key = 'likes' THEN pm.value END)::numeric
                 / MAX(CASE WHEN pm.metric_key = 'impressions' THEN pm.value END) * 100
            ELSE NULL
          END AS er_pct
        FROM posts p
        LEFT JOIN post_metrics pm
          ON pm.platform   = p.platform
          AND pm.account   = p.account
          AND pm.recorded_at >= p.created_at
          AND pm.recorded_at <  p.created_at + INTERVAL '7 days'
        WHERE p.platform = 'x'
          AND p.status IN ('done', 'approved')
          AND (${account}::text IS NULL OR p.account = ${account})
        GROUP BY p.id, p.content
      ) t
      GROUP BY content_type
      ORDER BY post_count DESC`;

    return NextResponse.json({
      data: rows.map(r => ({
        content_type:     r.content_type as string,
        post_count:       Number(r.post_count),
        avg_impressions:  r.avg_impressions != null ? Number(r.avg_impressions) : null,
        avg_er_pct:       r.avg_er_pct     != null ? Number(r.avg_er_pct)     : null,
      })),
    });
  } catch (err) {
    console.error('[x/content-type] query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 503 });
  }
}
