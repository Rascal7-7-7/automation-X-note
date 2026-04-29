import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const account = searchParams.get('account'); // null = all accounts

  try {
    const rows = await sql`
      WITH post_agg AS (
        SELECT
          post_id,
          account,
          MIN(recorded_at)                                          AS first_recorded,
          MAX(CASE WHEN metric_key = 'reach' THEN value END)        AS reach,
          MAX(CASE WHEN metric_key = 'saves' THEN value END)        AS saves
        FROM post_metrics
        WHERE platform = 'instagram'
          AND (${account}::text IS NULL OR account = ${account})
        GROUP BY post_id, account
      ),
      classified AS (
        SELECT
          pa.reach,
          pa.saves,
          CASE
            WHEN p.content ILIKE '%reels%'
              OR p.content ILIKE '%動画%'
              OR p.content ILIKE '%video%'
            THEN 'Reels'
            ELSE '静止画'
          END AS content_type
        FROM post_agg pa
        INNER JOIN LATERAL (
          SELECT content
          FROM posts
          WHERE platform = 'instagram'
            AND account = pa.account
            AND created_at BETWEEN pa.first_recorded - INTERVAL '7 days'
                               AND pa.first_recorded + INTERVAL '1 day'
          ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - pa.first_recorded)))
          LIMIT 1
        ) p ON true
      )
      SELECT
        content_type,
        COUNT(*)::int                                                                       AS post_count,
        ROUND(AVG(reach)::numeric, 1)::float                                               AS avg_reach,
        ROUND(AVG(saves)::numeric, 1)::float                                               AS avg_saves,
        ROUND(
          AVG(CASE WHEN reach > 0 THEN saves::float / reach * 100 END)::numeric, 2
        )::float                                                                           AS avg_save_rate
      FROM classified
      GROUP BY content_type
      ORDER BY content_type
    `;
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('[insta/content-type]', err);
    return NextResponse.json({ error: 'database error' }, { status: 503 });
  }
}
