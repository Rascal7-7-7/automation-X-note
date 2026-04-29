import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const rows = await sql`
      SELECT
        has_link,
        COUNT(*)::int                   AS post_count,
        ROUND(AVG(er_pct), 2)::numeric  AS avg_er_pct,
        ROUND(AVG(impressions))::int    AS avg_impressions
      FROM (
        SELECT
          p.id,
          (p.content ~* 'note\\.com|https?://')  AS has_link,
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
          AND p.created_at > NOW() - INTERVAL '30 days'
        GROUP BY p.id, p.content
      ) t
      GROUP BY has_link
      ORDER BY has_link DESC`;

    return NextResponse.json({
      data: rows.map(r => ({
        has_link:        Boolean(r.has_link),
        post_count:      Number(r.post_count),
        avg_er_pct:      r.avg_er_pct      != null ? Number(r.avg_er_pct)      : null,
        avg_impressions: r.avg_impressions  != null ? Number(r.avg_impressions) : null,
      })),
    });
  } catch (err) {
    console.error('[x/note-ctr] query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 503 });
  }
}
