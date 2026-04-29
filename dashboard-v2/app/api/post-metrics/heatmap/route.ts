import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const account  = searchParams.get('account');

  try {
    // day: 0=Sun,1=Mon,...,6=Sat  hour: 0-23
    const rows = await sql`
      SELECT
        EXTRACT(DOW  FROM recorded_at AT TIME ZONE 'Asia/Tokyo')::int AS day,
        EXTRACT(HOUR FROM recorded_at AT TIME ZONE 'Asia/Tokyo')::int AS hour,
        SUM(value)::int AS value
      FROM post_metrics
      WHERE metric_key IN ('impressions','likes','saves','reactions','bookmarks','engagement')
        AND recorded_at > NOW() - INTERVAL '90 days'
        AND (${platform}::text IS NULL OR platform = ${platform})
        AND (${account}::text  IS NULL OR account  = ${account})
      GROUP BY day, hour
      ORDER BY day, hour`;

    const cells = rows.map(r => ({
      day:   Number(r.day),
      hour:  Number(r.hour),
      value: Number(r.value),
    }));

    const max = cells.reduce((m, c) => Math.max(m, c.value), 0);
    return NextResponse.json({ cells, max });
  } catch (err) {
    console.error('[post-metrics/heatmap]', err);
    return NextResponse.json({ error: 'database error' }, { status: 500 });
  }
}
