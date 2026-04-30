import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

async function bridgeHealth() {
  const bridge = process.env.BRIDGE_URL;
  if (!bridge) return { ok: false, ts: null };
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(`${bridge}/health`, { signal: ctrl.signal });
    clearTimeout(tid);
    return { ok: r.ok, ts: new Date().toISOString() };
  } catch {
    return { ok: false, ts: null };
  }
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const [bridge, alertRows, metricRows, postRows] = await Promise.all([
    bridgeHealth(),
    sql`SELECT severity, COUNT(*) AS cnt FROM alerts WHERE resolved = false GROUP BY severity`,
    sql`SELECT key, value, recorded_at FROM metrics ORDER BY recorded_at DESC LIMIT 20`,
    sql`SELECT platform, COUNT(*) AS cnt FROM posts GROUP BY platform`,
  ]);

  const alertsByLevel = Object.fromEntries(
    alertRows.map((r) => [r.severity, Number(r.cnt)])
  );
  const postsByPlatform = Object.fromEntries(
    postRows.map((r) => [r.platform, Number(r.cnt)])
  );

  return NextResponse.json({
    bridge,
    alerts: { byLevel: alertsByLevel, totalUnresolved: alertRows.reduce((s, r) => s + Number(r.cnt), 0) },
    metrics: metricRows,
    posts: { byPlatform: postsByPlatform },
    ts: new Date().toISOString(),
  });
}
