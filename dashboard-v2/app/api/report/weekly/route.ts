import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function POST(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const [postRows, engRows, followerRows] = await Promise.all([
      // posts by platform in last 7 days
      sql`
        SELECT platform, COUNT(*) AS cnt, status
        FROM posts
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY platform, status
        ORDER BY platform, status`,
      // total engagement in last 7 days
      sql`
        SELECT platform, SUM(value)::int AS total
        FROM post_metrics
        WHERE metric_key IN ('impressions','likes','saves','reactions','bookmarks')
          AND recorded_at > NOW() - INTERVAL '7 days'
        GROUP BY platform
        ORDER BY total DESC`,
      // latest vs 7-days-ago followers per platform
      sql`
        SELECT platform,
          MAX(CASE WHEN recorded_at > NOW() - INTERVAL '1 day'   THEN value END) AS latest,
          MAX(CASE WHEN recorded_at BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '6 days' THEN value END) AS week_ago
        FROM sns_metrics
        WHERE metric_key = 'followers'
          AND recorded_at > NOW() - INTERVAL '8 days'
        GROUP BY platform`,
    ]);

    // build markdown
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const lines: string[] = [
      `# 週次レポート — ${now}`,
      '',
      '## 投稿サマリー（直近7日）',
      '',
    ];

    // group posts by platform
    const byPlatform: Record<string, { total: number; done: number; failed: number }> = {};
    for (const r of postRows) {
      const p = String(r.platform);
      if (!byPlatform[p]) byPlatform[p] = { total: 0, done: 0, failed: 0 };
      const cnt = Number(r.cnt);
      byPlatform[p].total += cnt;
      if (r.status === 'done' || r.status === 'approved') byPlatform[p].done += cnt;
      if (r.status === 'failed' || r.status === 'error')  byPlatform[p].failed += cnt;
    }

    if (Object.keys(byPlatform).length === 0) {
      lines.push('_投稿データなし_');
    } else {
      lines.push('| プラットフォーム | 投稿数 | 完了 | 失敗 |');
      lines.push('|---|---|---|---|');
      for (const [p, v] of Object.entries(byPlatform)) {
        lines.push(`| ${p} | ${v.total} | ${v.done} | ${v.failed} |`);
      }
    }

    lines.push('', '## エンゲージメント合計', '');
    if (engRows.length === 0) {
      lines.push('_データなし（post_metrics 未収集）_');
    } else {
      lines.push('| プラットフォーム | エンゲージメント合計 |');
      lines.push('|---|---|');
      for (const r of engRows) {
        lines.push(`| ${r.platform} | ${Number(r.total).toLocaleString()} |`);
      }
    }

    lines.push('', '## フォロワー増減（7日間）', '');
    if (followerRows.length === 0) {
      lines.push('_データなし（sns_metrics 未収集）_');
    } else {
      lines.push('| プラットフォーム | 直近 | 7日前 | 増減 |');
      lines.push('|---|---|---|---|');
      for (const r of followerRows) {
        const latest   = r.latest   != null ? Number(r.latest)   : null;
        const weekAgo  = r.week_ago != null ? Number(r.week_ago) : null;
        const diff     = latest != null && weekAgo != null ? latest - weekAgo : null;
        const diffStr  = diff != null ? (diff >= 0 ? `+${diff}` : String(diff)) : '—';
        lines.push(`| ${r.platform} | ${latest ?? '—'} | ${weekAgo ?? '—'} | ${diffStr} |`);
      }
    }

    lines.push('', '---', '_このレポートは dashboard-v2 が自動生成しました_');

    return NextResponse.json({
      markdown: lines.join('\n'),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: 'report generation failed', detail: String(err) }, { status: 503 });
  }
}
