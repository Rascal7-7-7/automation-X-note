import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const rows = await sql`
      WITH pivoted AS (
        SELECT
          pm.post_id,
          pm.account,
          MIN(pm.recorded_at)                                                               AS first_recorded,
          MAX(CASE WHEN pm.metric_key = 'ctr'         THEN pm.value END)                   AS ctr,
          MAX(CASE WHEN pm.metric_key = 'impressions' THEN pm.value END)                   AS impressions,
          MAX(CASE WHEN pm.metric_key = 'views'
                    AND pm.snapshot_at = 'total'      THEN pm.value END)                   AS views,
          MAX(CASE WHEN pm.metric_key = 'likes'       THEN pm.value END)                   AS likes,
          MAX(CASE WHEN pm.metric_key = 'comments'    THEN pm.value END)                   AS comments,
          MAX(CASE WHEN pm.metric_key = 'duration'    THEN pm.value END)                   AS duration_sec
        FROM post_metrics pm
        WHERE pm.platform = 'youtube'
        GROUP BY pm.post_id, pm.account
      ),
      with_meta AS (
        SELECT
          pv.*,
          po.content    AS post_content,
          po.media_url  AS media_url
        FROM pivoted pv
        LEFT JOIN LATERAL (
          SELECT content, media_url
          FROM posts
          WHERE platform = 'youtube'
            AND (account = pv.account OR account IS NULL)
            AND (
              media_url LIKE '%' || pv.post_id || '%'
              OR created_at BETWEEN pv.first_recorded - INTERVAL '7 days'
                                AND pv.first_recorded + INTERVAL '1 day'
            )
          ORDER BY
            CASE WHEN media_url LIKE '%' || pv.post_id || '%' THEN 0 ELSE 1 END,
            ABS(EXTRACT(EPOCH FROM (created_at - pv.first_recorded)))
          LIMIT 1
        ) po ON true
      )
      SELECT
        post_id,
        account,
        COALESCE(NULLIF(LEFT(post_content, 30), ''), post_id)    AS title,
        media_url                                                  AS thumbnail_url,
        ROUND(ctr::numeric, 2)::float                             AS ctr,
        impressions::int                                           AS impressions,
        CASE WHEN impressions > 0 AND ctr IS NOT NULL
             THEN ROUND((impressions * ctr / 100)::numeric)::int
             ELSE NULL END                                         AS clicks,
        views::int                                                 AS views,
        likes::int                                                 AS likes,
        comments::int                                              AS comments,
        duration_sec::int                                          AS duration_sec,
        CASE
          WHEN post_content ILIKE '%#shorts%'
            OR post_content ILIKE '%ショート%'
          THEN 'ショート'
          WHEN duration_sec IS NOT NULL AND duration_sec < 60
          THEN 'ショート'
          ELSE '長尺'
        END AS video_type
      FROM with_meta
      WHERE ctr IS NOT NULL OR views IS NOT NULL
      ORDER BY ctr DESC NULLS LAST
      LIMIT 50
    `;
    return NextResponse.json({ videos: rows });
  } catch (err) {
    console.error('[yt/video-stats]', err);
    return NextResponse.json({ error: 'database error' }, { status: 503 });
  }
}
