'use client';

import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Section, KpiGrid, EmptyState, TH, TD,
  SnsMetric, PostMetric,
  pivotByAccount, latestByAccount,
  CHART_STYLE, LINE_COLORS, TOOLTIP_STYLE, fmtTs,
} from '../ui';

export default function YTTab() {
  const [sns, setSns] = useState<SnsMetric[]>([]);
  const [pm, setPm]   = useState<PostMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/sns-metrics?platform=youtube&days=30').then(r => r.json()),
      fetch('/api/post-metrics?platform=youtube&limit=300').then(r => r.json()),
    ]).then(([s, p]) => {
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const { data: subData, accounts } = pivotByAccount(sns, 'subscribers');
  const latestSubs = latestByAccount(sns, 'subscribers');

  // type breakdown: short / long / reddit-short
  const viewsByType: Record<string, number> = {};
  pm.filter(m => m.metric_key === 'views' && m.snapshot_at === 'total').forEach(m => {
    const type = m.account ?? 'unknown';
    viewsByType[type] = (viewsByType[type] ?? 0) + m.value;
  });
  const typeBarData = Object.entries(viewsByType).map(([type, views]) => ({ type, views }));

  // CTR / retention table
  const ctrMap       = Object.fromEntries(pm.filter(m => m.metric_key === 'ctr').map(m => [m.post_id, m.value]));
  const retentionMap = Object.fromEntries(pm.filter(m => m.metric_key === 'retention_rate').map(m => [m.post_id, m.value]));
  const viewsMap     = Object.fromEntries(pm.filter(m => m.metric_key === 'views' && m.snapshot_at === 'total').map(m => [m.post_id, m.value]));
  const videoIds = [...new Set([...Object.keys(ctrMap), ...Object.keys(retentionMap)])];
  const videoTable = videoIds.slice(0, 10).map(id => ({
    id,
    views:     viewsMap[id]     ?? 0,
    ctr:       ctrMap[id]       ?? null,
    retention: retentionMap[id] ?? null,
  }));

  // 72h velocity (views at 1h, 6h, 24h, 72h)
  const snaps = ['1h', '6h', '24h', '72h'];
  const velocityIds = [...new Set(pm.filter(m => m.metric_key === 'views').map(m => m.post_id))].slice(0, 3);
  const velocityData = snaps.map(snap => {
    const entry: Record<string, number | string> = { snap };
    velocityIds.forEach(id => {
      const m = pm.find(p => p.post_id === id && p.metric_key === 'views' && p.snapshot_at === snap);
      if (m) entry[id.slice(-8)] = m.value;
    });
    return entry;
  });

  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
      <KpiGrid items={[
        [Object.values(latestSubs).reduce((s, v) => s + v, 0) || '—', 'チャンネル登録者数'],
        [videoIds.length || '—', 'CTR/維持率計測済み動画'],
        [typeBarData.length || '—', '動画タイプ数'],
        [videoTable[0]?.ctr != null ? `${videoTable[0].ctr}%` : '—', 'トップCTR'],
      ]} />

      <Section title="チャンネル登録者推移（30日）">
        {subData.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={subData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="date" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              {accounts.map((acct, i) => (
                <Line key={acct} type="monotone" dataKey={acct}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </Section>

      <Section title="タイプ別再生数（ショート vs 長尺 vs Redditショート）">
        {typeBarData.length ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={typeBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="type" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="views" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </Section>

      <Section title="動画別CTR / 視聴維持率">
        {videoTable.length ? (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr><TH>動画ID</TH><TH>再生数</TH><TH>CTR(%)</TH><TH>維持率(%)</TH></tr></thead>
              <tbody>{videoTable.map(v => (
                <tr key={v.id} className="hover:bg-neutral-800/30">
                  <TD className="font-mono">{v.id.slice(0, 16)}</TD>
                  <TD>{v.views.toLocaleString()}</TD>
                  <TD>{v.ctr ?? '—'}</TD>
                  <TD>{v.retention ?? '—'}</TD>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>

      <Section title="アップロード後72h 初速トレンド">
        {velocityData.some(d => Object.keys(d).length > 1) ? (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={velocityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="snap" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              {velocityIds.map((id, i) => (
                <Line key={id} type="monotone" dataKey={id.slice(-8)}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </Section>
    </>
  );
}
