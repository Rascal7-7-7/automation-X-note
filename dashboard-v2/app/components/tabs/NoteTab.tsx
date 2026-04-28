'use client';

import { useState, useEffect } from 'react';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Section, KpiGrid, EmptyState, TH, TD,
  SnsMetric, PostMetric,
  pivotByAccount, latestByAccount,
  CHART_STYLE, LINE_COLORS, TOOLTIP_STYLE, fmtTs,
} from '../ui';

export default function NoteTab() {
  const [sns, setSns] = useState<SnsMetric[]>([]);
  const [pm, setPm]   = useState<PostMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/sns-metrics?platform=note&days=30').then(r => r.json()),
      fetch('/api/post-metrics?platform=note&limit=200').then(r => r.json()),
    ]).then(([s, p]) => {
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const { data: likeData,     accounts: likeAccts }     = pivotByAccount(sns, 'likes');
  const { data: followerData, accounts: followerAccts }  = pivotByAccount(sns, 'followers');
  const latestFollowers = latestByAccount(sns, 'followers');
  const latestLikes     = latestByAccount(sns, 'likes');

  // top articles by likes
  const likePm = pm.filter(m => m.metric_key === 'likes' && m.snapshot_at === 'total');
  const topArticles = [...new Map(likePm.map(m => [m.post_id, m])).values()]
    .sort((a, b) => b.value - a.value).slice(0, 5);

  // viral alert: articles with +10 likes since yesterday
  const viralPosts = pm.filter(m => m.metric_key === 'likes' && m.snapshot_at === '24h' && m.value >= 10);

  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
      <KpiGrid items={[
        [Object.values(latestFollowers).reduce((s, v) => s + v, 0) || '—', '合計フォロワー'],
        [Object.values(latestLikes).reduce((s, v) => s + v, 0) || '—', '合計スキ(最新)'],
        [topArticles.length || '—', '計測済み記事数'],
        [viralPosts.length || 0, 'バイラルアラート(24h +10スキ)', viralPosts.length ? 'text-red-400' : ''],
      ]} />

      {viralPosts.length > 0 && (
        <div className="mb-3 p-3 rounded-lg border border-red-800 bg-red-950/30">
          <span className="text-red-400 text-xs font-bold">🔥 バイラルアラート</span>
          {viralPosts.map(p => (
            <div key={p.id} className="text-xs text-red-300 mt-1">
              {p.post_id} — +{p.value}スキ/24h ({p.account ?? '?'})
            </div>
          ))}
        </div>
      )}

      <Section title="スキ数推移（30日）">
        {likeData.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={likeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="date" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              {likeAccts.map((acct, i) => (
                <Line key={acct} type="monotone" dataKey={acct}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </Section>

      <Section title="フォロワー推移（30日）" defaultOpen={false}>
        {followerData.length ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={followerData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="date" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              {followerAccts.map((acct, i) => (
                <Line key={acct} type="monotone" dataKey={acct}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </Section>

      <Section title="上位記事 Top5（スキ順）">
        {topArticles.length ? (
          <table className="w-full border-collapse">
            <thead><tr><TH>post_id</TH><TH>アカウント</TH><TH>スキ数</TH><TH>記録日</TH></tr></thead>
            <tbody>{topArticles.map(p => (
              <tr key={p.id} className="hover:bg-neutral-800/30">
                <TD className="font-mono max-w-xs truncate">{p.post_id.slice(0, 30)}</TD>
                <TD>{p.account ?? '—'}</TD>
                <TD className="font-bold">{p.value.toLocaleString()}</TD>
                <TD>{fmtTs(p.recorded_at)}</TD>
              </tr>
            ))}</tbody>
          </table>
        ) : <EmptyState />}
      </Section>
    </>
  );
}
