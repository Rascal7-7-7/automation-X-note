import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

interface QualityEntry { ts: number; avgScore: number; }
type QualityData = Record<string, QualityEntry[]>;

const CATEGORY_TO_PLATFORM: Record<string, string> = {
  x:         'x',
  instagram: 'instagram',
  note:      'note',
  youtube:   'youtube',
};

function toWeekStart(ts: number): string {
  const d    = new Date(ts);
  const day  = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return mon.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const root   = process.env.AUTOMATION_ROOT ?? path.resolve(process.cwd(), '..');
    const qfPath = path.join(root, 'analytics', 'quality-feedback.json');
    const raw    = JSON.parse(fs.readFileSync(qfPath, 'utf8')) as QualityData;

    const points: Array<{ platform: string; avgScore: number; weekStart: string }> = [];
    for (const [cat, entries] of Object.entries(raw)) {
      const platform = CATEGORY_TO_PLATFORM[cat];
      if (!platform || !Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!Number.isFinite(e.avgScore) || !Number.isFinite(e.ts)) continue;
        points.push({ platform, avgScore: e.avgScore, weekStart: toWeekStart(e.ts) });
      }
    }

    if (!points.length) return NextResponse.json({ points: [] });

    const rows = await sql`
      SELECT
        platform,
        DATE_TRUNC('week', recorded_at)::date::text AS week_start,
        ROUND(AVG(value)::numeric, 2)              AS avg_er
      FROM sns_metrics
      WHERE metric_key IN ('engagement_rate', 'er')
        AND recorded_at >= NOW() - INTERVAL '90 days'
      GROUP BY platform, DATE_TRUNC('week', recorded_at)`;

    const erMap = new Map<string, number>();
    rows.forEach(r => erMap.set(`${r.platform}|${r.week_start}`, Number(r.avg_er)));

    const scatter = points
      .map(p => {
        const er = erMap.get(`${p.platform}|${p.weekStart}`);
        if (er == null) return null;
        return { platform: p.platform, avgScore: p.avgScore, er: Number(er) };
      })
      .filter((p): p is { platform: string; avgScore: number; er: number } => p !== null);

    return NextResponse.json({ points: scatter });
  } catch (err) {
    console.error('[analytics/quality-er]', err);
    return NextResponse.json({ error: 'query failed' }, { status: 503 });
  }
}
