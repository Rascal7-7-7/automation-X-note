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
      WITH post_agg AS (
        SELECT
          post_id,
          MAX(CASE WHEN metric_key = 'reach'  THEN value END) AS reach,
          MAX(CASE WHEN metric_key = 'saves'  THEN value END) AS saves,
          MAX(CASE WHEN metric_key = 'impressions' THEN value END) AS impressions
        FROM post_metrics
        WHERE platform = 'instagram'
          AND snapshot_at = 'total'
          AND (${account}::text IS NULL OR account = ${account})
        GROUP BY post_id
      ),
      classified AS (
        SELECT
          pa.reach,
          pa.saves,
          pa.impressions,
          CASE
            WHEN p.content ~* '(あなた|私も|わかる|辛い|大変|共感|悩み|苦しい)'   THEN '共感型'
            WHEN p.content ~* '([0-9]+万円|[0-9]+円|[0-9]+%|[0-9]+倍|[0-9]+件)'  THEN '数字型'
            WHEN p.content ~* '(？|\?|どう|何|ですか|でしょう|あなたは)'          THEN '問いかけ型'
            ELSE 'その他'
          END AS buzz_type
        FROM post_agg pa
        INNER JOIN LATERAL (
          SELECT content FROM posts
          WHERE id::text = pa.post_id
            AND platform = 'instagram'
            AND status IN ('done', 'approved')
          LIMIT 1
        ) p ON true
        WHERE pa.reach IS NOT NULL OR pa.saves IS NOT NULL
      )
      SELECT
        buzz_type,
        COUNT(*)::int                                                              AS post_count,
        ROUND(AVG(reach))::int                                                    AS avg_reach,
        ROUND(AVG(saves))::int                                                    AS avg_saves,
        CASE
          WHEN SUM(COALESCE(impressions, reach)) > 0
          THEN ROUND(SUM(saves)::numeric / SUM(COALESCE(impressions, reach)) * 100, 2)
          ELSE NULL
        END                                                                       AS save_rate_pct
      FROM classified
      GROUP BY buzz_type
      ORDER BY post_count DESC`;

    return NextResponse.json({
      data: rows.map(r => ({
        buzz_type:     r.buzz_type as string,
        post_count:    Number(r.post_count),
        avg_reach:     r.avg_reach  != null ? Number(r.avg_reach)  : null,
        avg_saves:     r.avg_saves  != null ? Number(r.avg_saves)  : null,
        save_rate_pct: r.save_rate_pct != null ? Number(r.save_rate_pct) : null,
      })),
    });
  } catch (err) {
    console.error('[instagram/buzz-type]', err);
    return NextResponse.json({ error: 'query failed' }, { status: 503 });
  }
}
