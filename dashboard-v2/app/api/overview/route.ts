import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

async function bridgeHealth() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch('http://localhost:3001/health', { signal: ctrl.signal });
    clearTimeout(tid);
    return { ok: r.ok, ts: new Date().toISOString() };
  } catch {
    return { ok: false, ts: null };
  }
}

export async function GET() {
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
