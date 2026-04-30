import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const days = Math.min(parseInt(searchParams.get('days') ?? '90') || 90, 365);

  try {
    const rows = platform
      ? await sql`
          SELECT platform, account, metric_key, value, recorded_date, recorded_at
          FROM sns_metrics
          WHERE platform = ${platform}
            AND recorded_at > NOW() - (${days} * INTERVAL '1 day')
          ORDER BY recorded_at DESC
          LIMIT 10000`
      : await sql`
          SELECT platform, account, metric_key, value, recorded_date, recorded_at
          FROM sns_metrics
          WHERE recorded_at > NOW() - (${days} * INTERVAL '1 day')
          ORDER BY recorded_at DESC
          LIMIT 10000`;

    const header = 'platform,account,metric_key,value,recorded_date,recorded_at';
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header,
      ...rows.map(r =>
        [r.platform, r.account, r.metric_key, r.value, r.recorded_date, r.recorded_at]
          .map(escape).join(',')
      ),
    ];

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="analytics-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error('[export/analytics]', err);
    return NextResponse.json({ error: 'export failed' }, { status: 503 });
  }
}
