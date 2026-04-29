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

interface Campaign {
  id: string;
  name: string;
  category: string;
  commission: string;
  status: string;
  url: string | null;
  affiliateUrl: string;
  approval_status: '設定済み' | 'URL未設定';
  clicks: number;
  cv: number;
  cvr: string;
}

function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : null;
  } catch { return null; }
}

function shortenUrl(url: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 30); }
}

function AffCtrBadge({ ctr }: { ctr: number }) {
  const cls = ctr >= 3
    ? 'bg-green-900 text-green-400 border-green-700'
    : ctr >= 1
      ? 'bg-amber-900 text-amber-400 border-amber-700'
      : 'bg-red-900 text-red-400 border-red-700';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] border font-mono ${cls}`}>
      {ctr.toFixed(2)}%
    </span>
  );
}

const AFF_CLICK_KEYS = new Set(['affiliate_clicks', 'link_clicks']);
const PV_KEYS        = new Set(['pv', 'pageviews']);

export default function GhostTab() {
  const [sns, setSns]             = useState<SnsMetric[]>([]);
  const [pm, setPm]               = useState<PostMetric[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    const safeFetch = (url: string) =>
      fetch(url, { signal: ctrl.signal }).then(r => {
        if (!r.ok) throw new Error(`${url} ${r.status}`);
        return r.json();
      });

    Promise.allSettled([
      safeFetch('/api/sns-metrics?platform=ghost&days=30'),
      safeFetch('/api/post-metrics?platform=ghost&limit=300'),
      safeFetch('/api/ghost-campaigns'),
    ]).then(([s, p, gc]) => {
      if (ctrl.signal.aborted) return;
      if (s.status  === 'fulfilled') setSns(s.value.metrics ?? []);
      if (p.status  === 'fulfilled') setPm(p.value.metrics ?? []);
      if (gc.status === 'fulfilled') setCampaigns(gc.value.campaigns ?? []);
      else console.error('[GhostTab/campaigns]', gc.status === 'rejected' ? gc.reason : '');
      setLoading(false);
    }).catch(e => {
      if (e.name !== 'AbortError') {
        console.error('[GhostTab]', e);
        setError('データの読み込みに失敗しました');
        setLoading(false);
      }
    });
    return () => ctrl.abort();
  }, []);

  const { data: pvData, accounts } = pivotByAccount(sns, 'pageviews');

  const sourceMeta = sns.filter(m => m.metric_key.startsWith('traffic.'));
  const pieData    = sourceMeta.map(m => ({
    name:  m.metric_key.replace('traffic.', ''),
    value: m.value,
  }));

  const clickMap   = Object.fromEntries(pm.filter(m => m.metric_key === 'clicks').map(m => [m.post_id, m.value]));
  const cvMap      = Object.fromEntries(pm.filter(m => m.metric_key === 'conversions').map(m => [m.post_id, m.value]));
  const revenueMap = Object.fromEntries(pm.filter(m => m.metric_key === 'revenue').map(m => [m.post_id, m.value]));
  const affIds     = [...new Set(Object.keys(clickMap))].slice(0, 10);
  const affTable   = affIds.map(id => ({
    id,
    clicks:  clickMap[id]   ?? 0,
    cv:      cvMap[id]      ?? 0,
    revenue: revenueMap[id] ?? 0,
  }));

  const pvPm     = pm.filter(m => m.metric_key === 'pageviews' && m.snapshot_at === 'total');
  const topPages = [...new Map(pvPm.map(m => [m.post_id, m])).values()]
    .sort((a, b) => b.value - a.value).slice(0, 5);

  const pendingCount = campaigns.filter(c => c.status === 'pending').length;
  const unsetCount   = campaigns.filter(c => c.approval_status === 'URL未設定').length;

  // affiliate CTR — client-side from post_metrics
  const affClickMap2: Record<string, number> = {};
  const pvMap2: Record<string, number> = {};
  pm.forEach(m => {
    if (AFF_CLICK_KEYS.has(m.metric_key)) affClickMap2[m.post_id] = (affClickMap2[m.post_id] ?? 0) + m.value;
    if (PV_KEYS.has(m.metric_key) && m.snapshot_at === 'total') pvMap2[m.post_id] = m.value;
  });
  const affCtrRows = Object.keys(pvMap2)
    .filter(id => pvMap2[id] > 0 && (affClickMap2[id] ?? 0) > 0)
    .map(id => ({
      id,
      pv:        pvMap2[id],
      affClicks: affClickMap2[id],
      ctr:       parseFloat(((affClickMap2[id] / pvMap2[id]) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 15);

  if (error) return <EmptyState msg={error} />;
  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
      <KpiGrid items={[
        [sns.filter(m => m.metric_key === 'pageviews').reduce((s, m) => s + m.value, 0) || '—', '総PV(計測期間)'],
        [campaigns.length || '—', 'ASP案件数'],
        [unsetCount, 'URL未設定', unsetCount > 0 ? 'text-red-400' : ''],
        [pendingCount || 0, '承認待ち案件', pendingCount ? 'text-amber-400' : ''],
      ]} />

      {/* ASP承認ステータスパネル */}
      <Section title="ASP承認ステータス">
        {campaigns.length ? (
          <>
            {unsetCount > 0 && (
              <div className="mb-3 px-3 py-2 rounded border border-red-800 bg-red-950/30 inline-flex items-center gap-2">
                <span className="text-red-400 text-xs font-bold">⚠ {unsetCount}件 URL未設定</span>
                <span className="text-red-300 text-xs">— ASPのアフィリURLを取得して設定してください</span>
              </div>
            )}
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="w-full border-collapse">
                <thead><tr>
                  <TH>ASP名 / 商品</TH>
                  <TH>カテゴリ</TH>
                  <TH>承認ステータス</TH>
                  <TH>アフィリURL</TH>
                </tr></thead>
                <tbody>
                  {campaigns.map(c => (
                    <tr
                      key={c.id}
                      className={`hover:bg-neutral-800/30 ${
                        c.approval_status === 'URL未設定' ? 'bg-red-950/20' : ''
                      }`}
                    >
                      <TD className="font-medium">{c.name}</TD>
                      <TD className="text-neutral-500">{c.category}</TD>
                      <TD>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                          c.approval_status === '設定済み'
                            ? 'bg-green-900 text-green-400 border-green-700'
                            : 'bg-red-900 text-red-400 border-red-700'
                        }`}>
                          {c.approval_status}
                        </span>
                      </TD>
                      <TD>
                        {c.affiliateUrl ? (
                          <a
                            href={safeUrl(c.affiliateUrl) ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-violet-400 hover:underline text-xs font-mono"
                          >
                            {shortenUrl(c.affiliateUrl)}
                          </a>
                        ) : (
                          <span className="text-red-400 text-xs">未設定</span>
                        )}
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <EmptyState msg="案件データなし" />}
      </Section>

      {/* アフィリリンククリック率 */}
      <Section title="記事別アフィリリンククリック率 TOP15">
        {affCtrRows.length ? (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>記事ID / タイトル</TH>
                <TH>PV</TH>
                <TH>アフィリクリック</TH>
                <TH>CTR</TH>
              </tr></thead>
              <tbody>
                {affCtrRows.map(r => (
                  <tr key={r.id} className="hover:bg-neutral-800/30">
                    <TD className="font-mono text-xs max-w-[200px] truncate">{r.id}</TD>
                    <TD>{r.pv.toLocaleString()}</TD>
                    <TD>{r.affClicks.toLocaleString()}</TD>
                    <TD><AffCtrBadge ctr={r.ctr} /></TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState msg="アフィリクリックデータなし（Bridge連携後に表示されます）" />
        )}
      </Section>

      <Section title={`ASP案件一覧（${campaigns.length}件）`}>
        {campaigns.length ? (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>名前</TH><TH>カテゴリ</TH><TH>報酬</TH><TH>ステータス</TH>
                <TH>クリック</TH><TH>CV</TH><TH>CVR</TH>
              </tr></thead>
              <tbody>{campaigns.map(c => (
                <tr
                  key={c.id}
                  className={`hover:bg-neutral-800/30 ${
                    c.status === 'pending' ? 'bg-amber-950/20' : ''
                  }`}
                >
                  <TD className="font-medium">
                    {(() => {
                      const href = safeUrl(c.url);
                      return href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                          className="text-violet-400 hover:underline">
                          {c.name}
                        </a>
                      ) : c.name;
                    })()}
                  </TD>
                  <TD className="text-neutral-500">{c.category}</TD>
                  <TD>{c.commission}</TD>
                  <TD>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                      c.status === 'active'
                        ? 'bg-green-950 text-green-400 border-green-800'
                        : c.status === 'rejected'
                        ? 'bg-red-950 text-red-400 border-red-800'
                        : c.status === 'pending'
                        ? 'bg-amber-950 text-amber-400 border-amber-800'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-600'
                    }`}>{c.status}</span>
                  </TD>
                  <TD>{c.clicks.toLocaleString()}</TD>
                  <TD>{c.cv}</TD>
                  <TD className={c.cvr !== '—' ? 'text-green-400 font-bold' : ''}>{c.cvr}</TD>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState msg="案件データなし" />}
      </Section>

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
              <thead><tr>
                <TH>案件ID</TH><TH>クリック</TH><TH>CV数</TH><TH>報酬(¥)</TH>
              </tr></thead>
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
