'use client';

import { useState, useEffect } from 'react';
import {
  LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Section, KpiGrid, EmptyState, TH, TD,
  SnsMetric, PostMetric,
  pivotByAccount,
  CHART_STYLE, LINE_COLORS, TOOLTIP_STYLE, fmtTs,
} from '../ui';

const PIE_COLORS = ['#7c6ff7', '#22c55e', '#f59e0b', '#3b82f6', '#ef4444'];

export default function GhostTab() {
  const [sns, setSns] = useState<SnsMetric[]>([]);
  const [pm, setPm]   = useState<PostMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/sns-metrics?platform=ghost&days=30').then(r => r.json()),
      fetch('/api/post-metrics?platform=ghost&limit=300').then(r => r.json()),
    ]).then(([s, p]) => {
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const { data: pvData, accounts } = pivotByAccount(sns, 'pageviews');

  // traffic source breakdown
  const sourceMeta = sns.filter(m => m.metric_key.startsWith('traffic.'));
  const pieData = sourceMeta.map(m => ({
    name: m.metric_key.replace('traffic.', ''),
    value: m.value,
  }));

  // affiliate clicks / CV / revenue
  const clickMap   = Object.fromEntries(pm.filter(m => m.metric_key === 'clicks').map(m => [m.post_id, m.value]));
  const cvMap      = Object.fromEntries(pm.filter(m => m.metric_key === 'conversions').map(m => [m.post_id, m.value]));
  const revenueMap = Object.fromEntries(pm.filter(m => m.metric_key === 'revenue').map(m => [m.post_id, m.value]));
  const affIds = [...new Set(Object.keys(clickMap))].slice(0, 10);
  const affTable = affIds.map(id => ({
    id,
    clicks:  clickMap[id]   ?? 0,
    cv:      cvMap[id]      ?? 0,
    revenue: revenueMap[id] ?? 0,
  }));

  // top articles (PV)
  const pvPm     = pm.filter(m => m.metric_key === 'pageviews' && m.snapshot_at === 'total');
  const topPages = [...new Map(pvPm.map(m => [m.post_id, m])).values()]
    .sort((a, b) => b.value - a.value).slice(0, 5);

  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
      <KpiGrid items={[
        [sns.filter(m => m.metric_key === 'pageviews').reduce((s, m) => s + m.value, 0) || '—', '総PV(計測期間)'],
        [affTable.length || '—', 'アフィリ計測記事数'],
        [affTable.reduce((s, r) => s + r.clicks, 0) || '—', '総アフィリクリック'],
        [affTable.reduce((s, r) => s + r.revenue, 0) || '—', '推定報酬合計(¥)'],
      ]} />

      <Section title="PV / UU 推移（30日）">
        {pvData.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pvData}>
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

      <div className="grid grid-cols-2 gap-4">
        <Section title="流入元内訳">
          {pieData.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </Section>

        <Section title="上位記事 Top5（PV順）">
          {topPages.length ? (
            <table className="w-full border-collapse">
              <thead><tr><TH>記事ID</TH><TH>PV</TH><TH>記録日</TH></tr></thead>
              <tbody>{topPages.map(p => (
                <tr key={p.id} className="hover:bg-neutral-800/30">
                  <TD className="font-mono">{p.post_id.slice(0, 24)}</TD>
                  <TD className="font-bold">{p.value.toLocaleString()}</TD>
                  <TD>{fmtTs(p.recorded_at)}</TD>
                </tr>
              ))}</tbody>
            </table>
          ) : <EmptyState />}
        </Section>
      </div>

      <Section title="アフィリ案件別 クリック・CV・報酬">
        {affTable.length ? (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr><TH>案件ID</TH><TH>クリック</TH><TH>CV数</TH><TH>報酬(¥)</TH></tr></thead>
              <tbody>{affTable.map(r => (
                <tr key={r.id} className="hover:bg-neutral-800/30">
                  <TD className="font-mono">{r.id.slice(0, 20)}</TD>
                  <TD>{r.clicks.toLocaleString()}</TD>
                  <TD>{r.cv}</TD>
                  <TD>{r.revenue.toLocaleString()}</TD>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>
    </>
  );
}
