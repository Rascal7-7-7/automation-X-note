import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';
import { sql } from '@/lib/db';

interface CuratorEntry {
  date: string;
  curator: string;
  articleTitle: string;
  url: string;
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  try {
    const raw     = await readFile(join(ROOT, 'note', 'curator-history.json'), 'utf-8');
    const history = JSON.parse(raw) as CuratorEntry[];
    if (!Array.isArray(history) || history.length === 0) {
      return NextResponse.json({ entries: [] });
    }

    // query sns_metrics for note daily pageviews around each curator date
    const dates = history
      .map(h => h.date)
      .filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));

    if (dates.length === 0) {
      return NextResponse.json({ entries: history.map(h => ({ ...h, pvBefore: null, pvAfter: null, pvGrowthPct: null })) });
    }

    const rows = await sql`
      SELECT recorded_date::text AS date, value
      FROM sns_metrics
      WHERE platform = 'note'
        AND metric_key = 'pageviews'
        AND recorded_date >= (SELECT MIN(d::date) - 14 FROM UNNEST(${dates}::text[]) AS d)
        AND recorded_date <= (SELECT MAX(d::date) + 14 FROM UNNEST(${dates}::text[]) AS d)
      ORDER BY recorded_date ASC`;

    const pvByDate: Record<string, number> = {};
    rows.forEach(r => { pvByDate[r.date as string] = Number(r.value); });

    const avgPv = (centerDate: string, offsetDays: number, windowDays: number): number | null => {
      const center = new Date(centerDate).getTime();
      const vals: number[] = [];
      for (let i = 0; i < windowDays; i++) {
        const d = new Date(center + (offsetDays + i) * 86_400_000).toISOString().slice(0, 10);
        if (pvByDate[d] != null) vals.push(pvByDate[d]);
      }
      if (vals.length === 0) return null;
      return parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(0));
    };

    const entries = history.map(h => {
      const pvBefore = avgPv(h.date, -7, 7);
      const pvAfter  = avgPv(h.date,  1, 7);
      const pvGrowthPct =
        pvBefore != null && pvAfter != null && pvBefore > 0
          ? parseFloat(((pvAfter - pvBefore) / pvBefore * 100).toFixed(1))
          : null;
      return { ...h, pvBefore, pvAfter, pvGrowthPct };
    });

    return NextResponse.json({ entries });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return NextResponse.json({ entries: [] });
    console.error('[note/curator-pv-impact]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
