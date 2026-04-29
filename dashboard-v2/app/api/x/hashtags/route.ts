import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const rows = await sql`
      WITH post_stats AS (
        SELECT
          p.id,
          p.content,
          MAX(CASE WHEN pm.metric_key = 'impressions' THEN pm.value END)  AS impressions,
          CASE
            WHEN MAX(CASE WHEN pm.metric_key = 'impressions' THEN pm.value END) > 0
            THEN MAX(CASE WHEN pm.metric_key = 'likes' THEN pm.value END)::numeric
                 / MAX(CASE WHEN pm.metric_key = 'impressions' THEN pm.value END) * 100
            ELSE NULL
          END AS er_pct
        FROM posts p
        LEFT JOIN post_metrics pm
          ON pm.platform    = p.platform
         AND pm.account     = p.account
         AND pm.recorded_at >= p.created_at
         AND pm.recorded_at <  p.created_at + INTERVAL '7 days'
        WHERE p.platform = 'x'
          AND p.status IN ('done', 'approved')
        GROUP BY p.id, p.content
      )
      SELECT
        '#' || m[1]                     AS hashtag,
        COUNT(*)::int                   AS post_count,
        ROUND(AVG(impressions))::int    AS avg_impressions,
        ROUND(AVG(er_pct), 1)::numeric  AS avg_er_pct
      FROM post_stats ps,
           LATERAL regexp_matches(
             ps.content,
             '#([A-Za-z0-9_゠-ヿぁ-ゟ一-鿿]+)',
             'g'
           ) AS m
      WHERE ps.content IS NOT NULL
      GROUP BY m[1]
      ORDER BY COALESCE(AVG(impressions), 0) DESC
      LIMIT 15`;

    return NextResponse.json({
      data: rows.map(r => ({
        hashtag:         r.hashtag         as string,
        post_count:      Number(r.post_count),
        avg_impressions: r.avg_impressions != null ? Number(r.avg_impressions) : null,
        avg_er_pct:      r.avg_er_pct      != null ? Number(r.avg_er_pct)      : null,
      })),
    });
  } catch (err) {
    console.error('[x/hashtags] query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 503 });
  }
}
