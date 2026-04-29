import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const rows = await sql`
      SELECT
        TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
        key,
        SUM(value)::numeric                                  AS total
      FROM metrics
      WHERE key ILIKE 'ghost.%'
        AND (key ILIKE '%revenue%' OR key ILIKE '%reward%' OR key ILIKE '%earning%')
      GROUP BY month, key
      ORDER BY month ASC`;

    // pivot: one row per month, one column per key
    const monthSet = new Set<string>();
    const keySet   = new Set<string>();
    const cellMap: Record<string, Record<string, number>> = {};

    rows.forEach(r => {
      const m = r.month as string;
      const k = r.key  as string;
      monthSet.add(m);
      keySet.add(k);
      if (!cellMap[m]) cellMap[m] = {};
      cellMap[m][k] = Number(r.total);
    });

    const keys   = [...keySet].sort();
    const series = [...monthSet].sort().map(month => {
      const row: Record<string, number | string> = { month };
      keys.forEach(k => { row[k] = cellMap[month]?.[k] ?? 0; });
      return row;
    });

    return NextResponse.json({ keys, series });
  } catch (err) {
    console.error('[ghost/monthly-revenue]', err);
    return NextResponse.json({ error: 'query failed' }, { status: 503 });
  }
}
