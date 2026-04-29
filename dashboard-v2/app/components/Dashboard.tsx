'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';
import XTab          from './tabs/XTab';
import NoteTab       from './tabs/NoteTab';
import InstaTab      from './tabs/InstaTab';
import YTTab         from './tabs/YTTab';
import GhostTab      from './tabs/GhostTab';
import SchedulerTab  from './tabs/SchedulerTab';
import PreviewModal   from './PreviewModal';
import DryRunToggle  from './DryRunToggle';

// ── types ─────────────────────────────────────────────────

interface OverviewData {
  bridge?: { ok: boolean; ts: string | null };
  alerts?: { byLevel: Record<string, number>; totalUnresolved: number };
  metrics?: Array<{ key: string; value: number; meta: unknown; recorded_at: string }>;
  posts?: { byPlatform: Record<string, number> };
  ts?: string;
}

interface Post {
  id: number; platform: string; account: string | null;
  content: string | null; status: string; error_msg: string | null;
  created_at: string;
}

interface Alert {
  id: number; severity: string; source: string | null;
  message: string; resolved: boolean; created_at: string;
}

interface Metric {
  id: number; key: string; value: number;
  meta: unknown; recorded_at: string;
}

interface CreditData {
  anthropic: unknown;
  fal: unknown;
  openai: unknown;
  ts: string;
  warnLow?: boolean;
}

// ── constants ─────────────────────────────────────────────

const TABS = ['Overview','X','note','Instagram','YouTube','Ghost','インフラ','スケジューラー','分析'] as const;
type Tab = typeof TABS[number];

const TAB_TO_PLATFORM: Partial<Record<Tab, string>> = {
  X: 'x', note: 'note', Instagram: 'instagram', YouTube: 'youtube', Ghost: 'ghost',
};
const PIE_COLORS = ['#22c55e','#f59e0b','#7c6ff7','#ef4444','#3b82f6'];
const CHART_STYLE = { fontSize: 11 };

// ── helpers ───────────────────────────────────────────────

function fmtTs(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ ok, label }: { ok: boolean | null; label: string }) {
  const cls = ok === null ? 'bg-neutral-800 text-neutral-400 border-neutral-600'
    : ok ? 'bg-green-950 text-green-400 border-green-800'
    : 'bg-red-950 text-red-400 border-red-800';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${cls}`}>
      {label}: {ok === null ? 'N/A' : ok ? 'UP' : 'DOWN'}
    </span>
  );
}

function SeverityBadge({ level }: { level: string }) {
  const cls = level === 'ERROR' ? 'bg-red-950 text-red-400 border-red-800'
    : level === 'WARN' ? 'bg-amber-950 text-amber-400 border-amber-800'
    : 'bg-neutral-800 text-neutral-400 border-neutral-600';
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cls}`}>{level}</span>;
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg p-4 ${className}`} style={{ background: '#161616', border: '1px solid #262626' }}>
      {children}
    </div>
  );
}

function KpiGrid({ items }: { items: Array<[string | number, string, string?]> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {items.map(([val, label, cls = '']) => (
        <Card key={label}>
          <div className={`text-2xl font-bold text-gray-100 ${cls}`}>{val}</div>
          <div className="text-[11px] text-neutral-500 mt-1">{label}</div>
        </Card>
      ))}
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="mb-3">
      <summary className="cursor-pointer text-sm font-semibold mb-3 py-2 px-4 rounded-lg select-none"
        style={{ background: '#161616', border: '1px solid #262626', color: '#a78bfa' }}>
        {title}
      </summary>
      <div className="px-1 pb-2">{children}</div>
    </details>
  );
}

function PostsTable({ posts }: { posts: Post[] }) {
  if (!posts.length) return <p className="text-xs text-neutral-500">データなし</p>;
  return (
    <div className="overflow-x-auto" style={{ maxHeight: 280, overflowY: 'auto' }}>
      <table className="w-full text-xs border-collapse">
        <thead><tr>
          {['プラットフォーム','アカウント','内容','ステータス','日時'].map(h =>
            <th key={h} className="text-left py-1.5 px-2 text-neutral-500 font-medium border-b" style={{ borderColor: '#262626' }}>{h}</th>
          )}
        </tr></thead>
        <tbody>{posts.map(p => (
          <tr key={p.id} className="hover:bg-neutral-800/30">
            <td className="py-1 px-2 text-neutral-300">{p.platform}</td>
            <td className="py-1 px-2 text-neutral-400">{p.account ?? '—'}</td>
            <td className="py-1 px-2 text-neutral-300 max-w-xs truncate">{p.content?.slice(0, 60) ?? '—'}</td>
            <td className="py-1 px-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                p.status === 'success' || p.status === 'done'
                  ? 'bg-green-950 text-green-400 border-green-800'
                  : p.status === 'failed'
                  ? 'bg-red-950 text-red-400 border-red-800'
                  : 'bg-neutral-800 text-neutral-400 border-neutral-600'
              }`}>{p.status}</span>
            </td>
            <td className="py-1 px-2 text-neutral-500">{fmtTs(p.created_at)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function AlertsTable({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="text-xs text-neutral-500">アラートなし</p>;
  return (
    <div style={{ maxHeight: 280, overflowY: 'auto' }}>
      {alerts.map(a => (
        <div key={a.id} className="flex gap-3 py-1.5 border-b items-start" style={{ borderColor: '#1f1f1f' }}>
          <span className="text-[11px] text-neutral-500 shrink-0 w-28">{fmtTs(a.created_at)}</span>
          <SeverityBadge level={a.severity} />
          <span className="text-xs text-neutral-300 truncate">{a.source ?? ''} {a.message.slice(0, 100)}</span>
        </div>
      ))}
    </div>
  );
}

// ── tab content ───────────────────────────────────────────

function OverviewTab({ data, posts, alerts }: { data: OverviewData; posts: Post[]; alerts: Alert[] }) {
  const platformData = Object.entries(data.posts?.byPlatform ?? {}).map(([name, cnt]) => ({ name, cnt }));
  return (
    <>
      <KpiGrid items={[
        [data.alerts?.totalUnresolved ?? '—', '未解決アラート', data.alerts?.totalUnresolved ? 'text-red-400' : ''],
        [data.posts?.byPlatform ? Object.values(data.posts.byPlatform).reduce((s, v) => s + v, 0) : '—', '総投稿数(DB)'],
        [data.metrics?.length ?? '—', 'メトリクスキー数'],
        [posts.filter(p => p.status === 'done').length, '本日 done'],
      ]} />
      <div className="grid grid-cols-2 gap-4">
        <Section title="プラットフォーム別投稿数">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={platformData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="name" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }} />
              <Bar dataKey="cnt" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
        <Section title="直近アラート">
          <AlertsTable alerts={alerts.slice(0, 8)} />
        </Section>
      </div>
    </>
  );
}

function PlatformTab({ platform, posts }: { platform: string; posts: Post[] }) {
  const filtered = posts.filter(p => p.platform === platform);
  const byStatus = filtered.reduce<Record<string, number>>((a, p) => ({ ...a, [p.status]: (a[p.status] ?? 0) + 1 }), {});
  const pieData = Object.entries(byStatus).map(([name, value]) => ({ name, value }));
  return (
    <>
      <KpiGrid items={[
        [filtered.length, `${platform} 投稿数(DB)`],
        [byStatus.done ?? byStatus.success ?? 0, '成功'],
        [byStatus.failed ?? 0, '失敗', byStatus.failed ? 'text-red-400' : ''],
        [filtered[0] ? fmtTs(filtered[0].created_at) : '—', '最終投稿'],
      ]} />
      <div className="grid grid-cols-2 gap-4">
        <Section title="ステータス分布">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
            </PieChart>
          </ResponsiveContainer>
        </Section>
        <Section title="直近投稿">
          <PostsTable posts={filtered.slice(0, 10)} />
        </Section>
      </div>
    </>
  );
}

function InfraTab({ data, alerts }: { data: OverviewData; alerts: Alert[] }) {
  const errorAlerts = alerts.filter(a => a.severity === 'ERROR');
  const warnAlerts = alerts.filter(a => a.severity === 'WARN');
  return (
    <>
      <KpiGrid items={[
        [data.bridge?.ok ? '● UP' : '● DOWN', 'Bridge Server :3001', data.bridge?.ok ? 'text-green-400' : 'text-red-400'],
        [errorAlerts.length, 'ERROR'],
        [warnAlerts.length, 'WARN'],
        [alerts.length, '総アラート(未解決)'],
      ]} />
      <Section title="Bridge Server">
        <div className="flex gap-3 items-center">
          <StatusBadge ok={data.bridge?.ok ?? null} label="Bridge :3001" />
          <span className="text-xs text-neutral-500">確認: {fmtTs(data.bridge?.ts ?? null)}</span>
        </div>
      </Section>
      <Section title="ERROR アラート">
        <AlertsTable alerts={errorAlerts.slice(0, 20)} />
      </Section>
      <Section title="WARN アラート" defaultOpen={false}>
        <AlertsTable alerts={warnAlerts.slice(0, 20)} />
      </Section>
    </>
  );
}

interface SnsMini { platform: string; metric_key: string; value: number; recorded_date: string; recorded_at: string; }
interface PostMini { post_id: string; platform: string; account: string | null; metric_key: string; value: number; }

function isoWeek(iso: string) {
  const d = new Date(iso);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
}

interface HeatCell { day: number; hour: number; value: number }

function AnalyticsTab({ metrics }: { metrics: Metric[] }) {
  const [snsAll, setSnsAll]       = useState<SnsMini[]>([]);
  const [postAll, setPostAll]     = useState<PostMini[]>([]);
  const [heatCells, setHeatCells] = useState<HeatCell[]>([]);
  const [heatMax, setHeatMax]     = useState(0);
  const [reportOpen, setReportOpen]   = useState(false);
  const [reportMd, setReportMd]       = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    // 60 days for monthly comparison
    fetch('/api/sns-metrics?days=60', { signal: ctrl.signal }).then(r => r.json())
      .then(d => setSnsAll(d.metrics ?? [])).catch(() => {});
    fetch('/api/post-metrics?limit=300', { signal: ctrl.signal }).then(r => r.json())
      .then(d => setPostAll(d.metrics ?? [])).catch(() => {});
    fetch('/api/post-metrics/heatmap', { signal: ctrl.signal }).then(r => r.json())
      .then(d => { setHeatCells(d.cells ?? []); setHeatMax(d.max ?? 0); }).catch(() => {});
    return () => ctrl.abort();
  }, []);

  async function generateReport() {
    setReportLoading(true);
    try {
      const r = await fetch('/api/report/weekly', { method: 'POST' });
      const d = await r.json() as { markdown?: string };
      setReportMd(d.markdown ?? '生成失敗');
      setReportOpen(true);
    } catch {
      setReportMd('レポート生成エラー');
      setReportOpen(true);
    } finally {
      setReportLoading(false);
    }
  }

  const latestByKey = metrics.reduce<Record<string, Metric>>((acc, m) => {
    if (!acc[m.key] || new Date(m.recorded_at) > new Date(acc[m.key].recorded_at)) acc[m.key] = m;
    return acc;
  }, {});
  const keyList = Object.keys(latestByKey);
  const barData = keyList.map(k => ({ name: k.split('.')[1] ?? k, value: Number(latestByKey[k].value) }));

  // weekly follower growth rate per platform
  const followerRows = snsAll.filter(m => m.metric_key === 'followers');
  const weeklyByPlatform: Record<string, Record<number, number>> = {};
  followerRows.forEach(m => {
    const w = isoWeek(m.recorded_date ?? m.recorded_at);
    if (!weeklyByPlatform[m.platform]) weeklyByPlatform[m.platform] = {};
    weeklyByPlatform[m.platform][w] = Math.max(weeklyByPlatform[m.platform][w] ?? 0, m.value);
  });
  const allWeeks = [...new Set(followerRows.map(m => isoWeek(m.recorded_date ?? m.recorded_at)))].sort();
  const growthData = allWeeks.length >= 2
    ? Object.keys(weeklyByPlatform).map(p => {
        const [prevW, currW] = allWeeks.slice(-2);
        const prev = weeklyByPlatform[p][prevW] ?? 0;
        const curr = weeklyByPlatform[p][currW] ?? 0;
        return { platform: p, growth: prev > 0 ? parseFloat(((curr - prev) / prev * 100).toFixed(1)) : 0 };
      })
    : [];

  // buzz ranking: top posts by summed engagement signals
  const engScores: Record<string, number> = {};
  const engMeta: Record<string, { account: string; platform: string }> = {};
  postAll
    .filter(m => ['impressions', 'likes', 'saves', 'reactions', 'bookmarks'].includes(m.metric_key))
    .forEach(m => {
      engScores[m.post_id] = (engScores[m.post_id] ?? 0) + m.value;
      engMeta[m.post_id] = { account: m.account ?? '—', platform: m.platform };
    });
  const buzzRanking = Object.entries(engScores)
    .sort(([, a], [, b]) => b - a).slice(0, 10)
    .map(([post_id, score]) => ({ post_id, score, ...engMeta[post_id] }));

  // WoW / MoM follower delta per platform (using 60-day snsAll)
  const NOW_MS = Date.now();
  const DAY_MS = 86_400_000;
  const platforms = [...new Set(followerRows.map(m => m.platform))];
  const wowMomBadges = platforms.map(pf => {
    const rows = followerRows
      .filter(m => m.platform === pf)
      .map(m => ({ ...m, ts: new Date(m.recorded_date ?? m.recorded_at).getTime() }))
      .sort((a, b) => b.ts - a.ts);
    const curr = rows[0]?.value ?? null;
    const closest = (daysAgo: number) =>
      rows.reduce<{ value: number; ts: number } | null>((best, r) => {
        const target = NOW_MS - daysAgo * DAY_MS;
        return !best || Math.abs(r.ts - target) < Math.abs(best.ts - target) ? r : best;
      }, null);
    const w7  = closest(7);
    const w30 = closest(30);
    return {
      platform: pf,
      curr,
      wow: curr != null && w7  ? curr - w7.value  : null,
      mom: curr != null && w30 ? curr - w30.value : null,
    };
  });

  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  const heatMap: Record<string, number> = {};
  heatCells.forEach(c => { heatMap[`${c.day}-${c.hour}`] = c.value; });

  const TH2 = ({ children }: { children: React.ReactNode }) => (
    <th className="text-left py-1.5 px-2 text-neutral-500 font-medium border-b text-[11px]"
      style={{ borderColor: '#262626' }}>{children}</th>
  );
  const TD2 = ({ children, cls = '' }: { children: React.ReactNode; cls?: string }) => (
    <td className={`py-1 px-2 text-neutral-300 text-xs ${cls}`}>{children}</td>
  );

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex-1">
          <KpiGrid items={[
            [keyList.length, 'ユニークメトリクス'],
            [metrics.length, '総レコード数'],
            [latestByKey['x.sampleSize']?.value ?? '—', 'X サンプル数'],
            [latestByKey['note.sampleSize']?.value ?? '—', 'note サンプル数'],
          ]} />
        </div>
        <button
          onClick={generateReport}
          disabled={reportLoading}
          className="mt-1 px-3 py-1.5 rounded text-xs font-semibold border border-violet-700 bg-violet-950 text-violet-300 hover:bg-violet-900 disabled:opacity-50 whitespace-nowrap"
        >
          {reportLoading ? '生成中...' : '📊 週次レポート生成'}
        </button>
      </div>

      {/* ── Posting heatmap ──────────────────────────────── */}
      <Section title="投稿時間帯ヒートマップ（直近90日）">
        {heatCells.length > 0 ? (
          <div className="overflow-x-auto">
            <div style={{ display: 'grid', gridTemplateColumns: '24px repeat(24, 1fr)', gap: 2, minWidth: 560 }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={`h-${h}`} className="text-center text-[9px] text-neutral-600">{h}</div>
              ))}
              {DAY_NAMES.flatMap((day, d) => [
                <div key={`l-${d}`} className="text-[10px] text-neutral-500 flex items-center justify-center">{day}</div>,
                ...Array.from({ length: 24 }, (_, h) => {
                  const v = heatMap[`${d}-${h}`] ?? 0;
                  const intensity = heatMax > 0 ? v / heatMax : 0;
                  return (
                    <div
                      key={`c-${d}-${h}`}
                      title={`${day} ${h}:00 — ${v.toLocaleString()}`}
                      style={{
                        height: 14,
                        borderRadius: 2,
                        background: intensity > 0
                          ? `rgba(99,102,241,${Math.max(0.1, intensity).toFixed(2)})`
                          : '#1a1a1a',
                      }}
                    />
                  );
                }),
              ])}
            </div>
            <p className="mt-1.5 text-[10px] text-neutral-600">
              濃いほどエンゲージメント合計が高い時間帯 (impressions・likes・saves 等の合算)
            </p>
          </div>
        ) : <p className="text-xs py-6 text-center text-neutral-500">post_metrics 収集後に表示（90日分集計）</p>}
      </Section>

      {/* ── WoW / MoM follower badges ─────────────────────── */}
      {wowMomBadges.length > 0 && (
        <Section title="フォロワー増減（前週比 WoW・前月比 MoM）">
          <div className="flex flex-wrap gap-3">
            {wowMomBadges.map(b => {
              const fmtDiff = (d: number | null) =>
                d === null ? '—' : d >= 0 ? `+${d.toLocaleString()}` : d.toLocaleString();
              const diffCls = (d: number | null) =>
                d === null ? 'text-neutral-500'
                : d > 0 ? 'text-green-400'
                : d < 0 ? 'text-red-400'
                : 'text-neutral-400';
              return (
                <div
                  key={b.platform}
                  className="flex flex-col gap-1 px-3 py-2 rounded border"
                  style={{ background: '#111', borderColor: '#2a2a2a', minWidth: 130 }}
                >
                  <span className="text-[11px] font-semibold text-neutral-200">{b.platform}</span>
                  <span className="text-[10px] text-neutral-500">
                    {b.curr != null ? b.curr.toLocaleString() : '—'} followers
                  </span>
                  <div className="flex gap-3">
                    <span className={`text-[11px] font-mono ${diffCls(b.wow)}`}>WoW {fmtDiff(b.wow)}</span>
                    <span className={`text-[11px] font-mono ${diffCls(b.mom)}`}>MoM {fmtDiff(b.mom)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Section title="週次フォロワー成長率">
          {growthData.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={growthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                <XAxis dataKey="platform" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis unit="%" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }}
                  formatter={(v: unknown) => [`${v}%`, '成長率']}
                />
                <Bar dataKey="growth" fill="#22c55e40" stroke="#22c55e" strokeWidth={1} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-xs py-6 text-center text-neutral-500">sns_metrics 2週分蓄積後に表示</p>}
        </Section>

        <Section title="バズ投稿 Top10（エンゲージメント合計）">
          {buzzRanking.length ? (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              <table className="w-full border-collapse">
                <thead><tr>
                  <TH2>#</TH2><TH2>post_id</TH2><TH2>SNS</TH2><TH2>Acct</TH2><TH2>Score</TH2>
                </tr></thead>
                <tbody>{buzzRanking.map((r, i) => (
                  <tr key={r.post_id} className="hover:bg-neutral-800/30">
                    <TD2 cls="text-neutral-500">{i + 1}</TD2>
                    <TD2 cls="font-mono">{r.post_id.slice(0, 16)}</TD2>
                    <TD2>{r.platform}</TD2>
                    <TD2>{r.account}</TD2>
                    <TD2 cls="font-bold text-violet-400">{r.score.toLocaleString()}</TD2>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-xs py-6 text-center text-neutral-500">post_metrics 収集後に表示</p>}
        </Section>
      </div>

      <Section title="最新メトリクス一覧">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
            <XAxis type="number" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
            <YAxis type="category" dataKey="name" width={100} tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
            <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }} />
            <Bar dataKey="value" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} />
          </BarChart>
        </ResponsiveContainer>
      </Section>

      <Section title="全メトリクス" defaultOpen={false}>
        <div className="overflow-x-auto" style={{ maxHeight: 240, overflowY: 'auto' }}>
          <table className="w-full text-xs border-collapse">
            <thead><tr>
              {['key', 'value', '記録日時'].map(h =>
                <th key={h} className="text-left py-1.5 px-2 text-neutral-500 font-medium border-b"
                  style={{ borderColor: '#262626' }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{Object.values(latestByKey).map(m => (
              <tr key={m.id} className="hover:bg-neutral-800/30">
                <td className="py-1 px-2 text-neutral-300">{m.key}</td>
                <td className="py-1 px-2 text-neutral-300">{m.value}</td>
                <td className="py-1 px-2 text-neutral-500">{fmtTs(m.recorded_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      {/* ── 週次レポートモーダル ────────────────────────────── */}
      {reportOpen && reportMd !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setReportOpen(false)}
        >
          <div
            className="relative flex flex-col rounded-lg border"
            style={{ width: 660, maxHeight: '82vh', background: '#111', borderColor: '#333' }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-2 border-b"
              style={{ borderColor: '#262626' }}
            >
              <span className="text-xs font-semibold text-neutral-200">📊 週次レポート</span>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(reportMd ?? '')}
                  className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
                >
                  コピー
                </button>
                <button
                  onClick={() => setReportOpen(false)}
                  className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500"
                >
                  閉じる
                </button>
              </div>
            </div>
            <pre
              className="flex-1 overflow-auto text-[11px] text-neutral-300 p-4 leading-relaxed"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {reportMd}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

// ── main Dashboard ────────────────────────────────────────

export default function Dashboard() {
  const [tab, setTab]               = useState<Tab>('Overview');
  const [overview, setOverview]     = useState<OverviewData>({});
  const [posts, setPosts]           = useState<Post[]>([]);
  const [metrics, setMetrics]       = useState<Metric[]>([]);
  const [alerts, setAlerts]         = useState<Alert[]>([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const [loading, setLoading]       = useState(true);
  const [previewOpen, setPreviewOpen]   = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [dryRun, setDryRun]             = useState(true);
  const [creditWarn, setCreditWarn]     = useState(false);

  const fetchAll = useCallback(async () => {
    const [ov, po, me, al] = await Promise.allSettled([
      fetch('/api/overview').then(r => r.json()),
      fetch('/api/posts?limit=100').then(r => r.json()),
      fetch('/api/metrics?limit=200').then(r => r.json()),
      fetch('/api/alerts?limit=100').then(r => r.json()),
    ]);
    if (ov.status === 'fulfilled') setOverview(ov.value);
    if (po.status === 'fulfilled') setPosts(po.value.posts ?? []);
    if (me.status === 'fulfilled') setMetrics(me.value.metrics ?? []);
    if (al.status === 'fulfilled') {
      setAlerts(al.value.alerts ?? []);
    }
    fetch('/api/credits').then(r => r.json())
      .then((d: CreditData) => { setCreditWarn(d.warnLow ?? false); })
      .catch(() => {});
    // pending count for approval badge
    fetch('/api/preview?limit=200').then(r => r.json())
      .then(d => setPendingCount((d.drafts ?? []).length))
      .catch(() => {});
    setLastUpdated(new Date().toLocaleTimeString('ja-JP'));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  function renderTab() {
    if (loading) return <div className="py-16 text-center text-xs text-neutral-500">読み込み中...</div>;
    switch (tab) {
      case 'Overview': return <OverviewTab data={overview} posts={posts} alerts={alerts} />;
      case 'X': return <XTab />;
      case 'note': return <NoteTab />;
      case 'Instagram': return <InstaTab />;
      case 'YouTube': return <YTTab />;
      case 'Ghost': return <GhostTab />;
      case 'インフラ': return <InfraTab data={overview} alerts={alerts} />;
      case 'スケジューラー': return <SchedulerTab />;
      case '分析': return <AnalyticsTab metrics={metrics} />;
      default: return null;
    }
  }

  return (
    <div className="min-h-screen font-mono text-sm" style={{ background: '#0d0d0d' }}>
      {/* header */}
      <div className="sticky top-0 z-50 flex items-center gap-3 px-4 py-2"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #262626' }}>
        <span className="font-bold text-sm" style={{ color: '#7c6ff7' }}>SNS AUTO v2</span>
        <div className="flex gap-2 ml-1">
          <StatusBadge ok={overview.bridge?.ok ?? null} label="Bridge" />
          {overview.alerts?.totalUnresolved ? (
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold border bg-red-950 text-red-400 border-red-800">
              alerts: {overview.alerts.totalUnresolved}
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <DryRunToggle onToggle={setDryRun} />
          {lastUpdated && <span className="text-xs text-neutral-500">更新: {lastUpdated}</span>}
          <button
            onClick={() => setPreviewOpen(true)}
            className="relative text-xs px-3 py-1 rounded font-semibold"
            style={{ background: '#1a1040', border: '1px solid #7c6ff750', color: '#a78bfa' }}
          >
            📋 承認キュー
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full text-[9px] flex items-center justify-center font-bold"
                style={{ background: '#ef4444', color: '#fff' }}>{pendingCount}</span>
            )}
          </button>
          <button onClick={fetchAll}
            className="text-xs px-2 py-1 rounded text-neutral-400 hover:text-neutral-200"
            style={{ background: '#1f1f1f' }}>↻</button>
        </div>
      </div>

      {creditWarn && (
        <div className="px-4 py-2 text-xs font-semibold flex items-center gap-2"
          style={{ background: '#451a03', borderBottom: '1px solid #92400e', color: '#fcd34d' }}>
          ⚠ API クレジット残高不足 — Anthropic のクレジット補充が必要です（直近24hエラー検出）
        </div>
      )}

      {/* tabs */}
      <div className="flex gap-1 px-4 overflow-x-auto"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #262626' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3.5 py-2 rounded-t text-xs whitespace-nowrap transition-colors ${
              tab === t
                ? 'text-gray-100 bg-neutral-800'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
            }`}
            style={tab === t ? { borderBottom: '2px solid #7c6ff7' } : {}}>
            {t}
          </button>
        ))}
      </div>

      {/* content */}
      <div className="p-4 max-w-screen-2xl mx-auto">
        {renderTab()}
      </div>

      {previewOpen && (
        <PreviewModal
          platform={TAB_TO_PLATFORM[tab]}
          dryRun={dryRun}
          onClose={() => { setPreviewOpen(false); fetchAll(); }}
        />
      )}
    </div>
  );
}
