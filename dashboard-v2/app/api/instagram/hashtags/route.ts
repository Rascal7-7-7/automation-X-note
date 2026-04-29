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
      WITH post_stats AS (
        SELECT
          p.id,
          p.content,
          MAX(CASE WHEN pm.metric_key = 'reach'  THEN pm.value END)  AS reach,
          MAX(CASE WHEN pm.metric_key = 'saves'  THEN pm.value END)  AS saves
        FROM posts p
        LEFT JOIN post_metrics pm
          ON pm.platform    = p.platform
         AND pm.account     = p.account
         AND pm.recorded_at >= p.created_at
         AND pm.recorded_at <  p.created_at + INTERVAL '7 days'
        WHERE p.platform = 'instagram'
          AND p.status IN ('done', 'approved')
          AND (${account}::text IS NULL OR p.account = ${account})
        GROUP BY p.id, p.content
      )
      SELECT
        '#' || m[1]                              AS hashtag,
        COUNT(*)::int                            AS post_count,
        ROUND(AVG(reach))::int                   AS avg_reach,
        ROUND(AVG(saves), 1)::numeric            AS avg_saves,
        ROUND(
          AVG(CASE WHEN reach > 0 THEN saves::numeric / reach * 100 END), 2
        )::numeric                               AS avg_save_rate
      FROM post_stats ps,
           LATERAL regexp_matches(
             ps.content,
             '#([A-Za-z0-9_゠-ヿぁ-ゟ一-鿿]+)',
             'g'
           ) AS m
      WHERE ps.content IS NOT NULL
      GROUP BY m[1]
      ORDER BY COALESCE(
        AVG(CASE WHEN reach > 0 THEN saves::numeric / reach * 100 END), 0
      ) DESC
      LIMIT 10`;

    return NextResponse.json({
      data: rows.map(r => ({
        hashtag:      r.hashtag       as string,
        post_count:   Number(r.post_count),
        avg_reach:    r.avg_reach     != null ? Number(r.avg_reach)     : null,
        avg_saves:    r.avg_saves     != null ? Number(r.avg_saves)     : null,
        avg_save_rate: r.avg_save_rate != null ? Number(r.avg_save_rate) : null,
      })),
    });
  } catch (err) {
    console.error('[instagram/hashtags] query failed', err);
    return NextResponse.json({ error: 'query failed' }, { status: 503 });
  }
}
