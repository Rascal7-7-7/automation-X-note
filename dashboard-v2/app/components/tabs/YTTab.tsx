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

interface PipelineItem {
  id: number;
  type: string;
  status: string;
  title: string;
  error: string | null;
  created: string;
}

interface PipelineData {
  pipeline: PipelineItem[];
  byStatus: Record<string, number>;
}

function pipelineCls(s: string) {
  if (s === 'done' || s === 'success') return 'bg-green-950 text-green-400 border-green-800';
  if (s === 'failed' || s === 'error') return 'bg-red-950 text-red-400 border-red-800';
  if (s === 'rendering' || s === 'retrying') return 'bg-blue-950 text-blue-400 border-blue-800';
  if (s === 'pending') return 'bg-amber-950 text-amber-400 border-amber-800';
  return 'bg-neutral-800 text-neutral-400 border-neutral-600';
}

export default function YTTab() {
  const [sns, setSns]           = useState<SnsMetric[]>([]);
  const [pm, setPm]             = useState<PostMetric[]>([]);
  const [pipeline, setPipeline] = useState<PipelineData>({ pipeline: [], byStatus: {} });
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetch('/api/sns-metrics?platform=youtube&days=30', { signal: ctrl.signal }).then(r => r.json()),
      fetch('/api/post-metrics?platform=youtube&limit=300', { signal: ctrl.signal }).then(r => r.json()),
      fetch('/api/yt-pipeline', { signal: ctrl.signal }).then(r => r.json()),
    ]).then(([s, p, pl]) => {
      if (ctrl.signal.aborted) return;
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setPipeline(pl);
      setLoading(false);
    }).catch(e => { if (e.name !== 'AbortError') setLoading(false); });
    return () => ctrl.abort();
  }, []);

  const { data: subData, accounts } = pivotByAccount(sns, 'subscribers');
  const latestSubs = latestByAccount(sns, 'subscribers');

  const viewsByType: Record<string, number> = {};
  pm.filter(m => m.metric_key === 'views' && m.snapshot_at === 'total').forEach(m => {
    const type = m.account ?? 'unknown';
    viewsByType[type] = (viewsByType[type] ?? 0) + m.value;
  });
  const typeBarData = Object.entries(viewsByType).map(([type, views]) => ({ type, views }));

  const ctrMap       = Object.fromEntries(pm.filter(m => m.metric_key === 'ctr').map(m => [m.post_id, m.value]));
  const retentionMap = Object.fromEntries(pm.filter(m => m.metric_key === 'retention_rate').map(m => [m.post_id, m.value]));
  const viewsMap     = Object.fromEntries(pm.filter(m => m.metric_key === 'views' && m.snapshot_at === 'total').map(m => [m.post_id, m.value]));
  const videoIds     = [...new Set([...Object.keys(ctrMap), ...Object.keys(retentionMap)])];
  const videoTable   = videoIds.slice(0, 10).map(id => ({
    id,
    views:     viewsMap[id]     ?? 0,
    ctr:       ctrMap[id]       ?? null,
    retention: retentionMap[id] ?? null,
  }));

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

  const failedItems = pipeline.pipeline.filter(p => p.status === 'failed' || p.status === 'error');

  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
      {failedItems.length > 0 && (
        <div className="mb-3 p-3 rounded-lg border border-red-800 bg-red-950/30">
          <span className="text-red-400 text-xs font-bold">❌ パイプライン失敗 {failedItems.length}件</span>
          {failedItems.slice(0, 3).map(p => (
            <div key={p.id} className="text-xs text-red-300 mt-1 truncate">{p.title} — {p.error ?? 'unknown error'}</div>
          ))}
        </div>
      )}

      <KpiGrid items={[
        [Object.values(latestSubs).reduce((s, v) => s + v, 0) || '—', 'チャンネル登録者数'],
        [pipeline.byStatus.pending ?? 0, 'キュー待機中', (pipeline.byStatus.pending ?? 0) > 0 ? 'text-amber-400' : ''],
        [pipeline.byStatus.rendering ?? 0, 'レンダリング中', (pipeline.byStatus.rendering ?? 0) > 0 ? 'text-blue-400' : ''],
        [pipeline.byStatus.failed ?? 0, 'パイプライン失敗', (pipeline.byStatus.failed ?? 0) > 0 ? 'text-red-400' : ''],
      ]} />

      <Section title="パイプライン進捗（直近30件）">
        {pipeline.pipeline.length ? (
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>タイトル</TH>
                <TH>種別</TH>
                <TH>ステータス</TH>
                <TH>作成日時</TH>
              </tr></thead>
              <tbody>
                {pipeline.pipeline.map(p => (
                  <tr key={p.id} className="hover:bg-neutral-800/30">
                    <TD className="max-w-xs truncate">{p.title}</TD>
                    <TD>{p.type}</TD>
                    <TD>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] border ${pipelineCls(p.status)}`}>
                        {p.status}
                      </span>
                    </TD>
                    <TD>{fmtTs(p.created)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>

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

      <Section title="タイプ別再生数">
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

      <Section title="アップロード後72h 初速トレンド" defaultOpen={false}>
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
