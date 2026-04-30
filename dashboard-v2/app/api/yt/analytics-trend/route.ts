import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

interface AnalyticsSnapshot {
  date:               string;
  views:              number;
  watchMinutes:       number;
  avgViewPct:         number;
  subscribersGained:  number;
  subscribersLost:    number;
  likes:              number;
  comments:           number;
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const root = process.env.AUTOMATION_ROOT ?? path.resolve(process.cwd(), '..');
    const dir  = path.join(root, 'youtube', 'analytics');

    if (!fs.existsSync(dir)) return NextResponse.json({ snapshots: [], latest: null });

    const files = fs.readdirSync(dir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();

    const snapshots: AnalyticsSnapshot[] = files.flatMap(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const ch  = raw.channel ?? {};
        return [{
          date:              raw.date as string,
          views:             Number(ch.views             ?? 0),
          watchMinutes:      Number(ch.estimatedMinutesWatched ?? 0),
          avgViewPct:        Math.min(100, Number(ch.averageViewPercentage ?? 0)),
          subscribersGained: Number(ch.subscribersGained ?? 0),
          subscribersLost:   Number(ch.subscribersLost   ?? 0),
          likes:             Number(ch.likes             ?? 0),
          comments:          Number(ch.comments          ?? 0),
        }];
      } catch { return []; }
    });

    const latest = snapshots.at(-1) ?? null;

    return NextResponse.json({ snapshots, latest });
  } catch (err) {
    console.error('[yt/analytics-trend]', err);
    return NextResponse.json({ error: 'failed' }, { status: 503 });
  }
}
