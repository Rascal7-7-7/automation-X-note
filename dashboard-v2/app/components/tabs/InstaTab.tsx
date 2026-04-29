'use client';

import { Fragment, useState, useEffect } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Section, KpiGrid, EmptyState, TH, TD,
  SnsMetric, PostMetric,
  pivotByAccount, latestByAccount,
  CHART_STYLE, LINE_COLORS, TOOLTIP_STYLE, fmtTs,
} from '../ui';

const INSTA_ACCOUNTS = ['all', 'acct1', 'acct2', 'acct3'] as const;
type AcctFilter = (typeof INSTA_ACCOUNTS)[number];

interface TokenInfo {
  account: string;
  expiresAt: string | null;
  daysLeft: number | null;
  status: 'ok' | 'warn' | 'expired' | 'unknown';
}

interface BuzzTypeStat {
  buzz_type: string;
  post_count: number;
  avg_reach: number | null;
  avg_saves: number | null;
  save_rate_pct: number | null;
}

interface ContentTypeStat {
  content_type: string;
  post_count: number;
  avg_reach: number | null;
  avg_saves: number | null;
  avg_save_rate: number | null;
}

// ── InstaHeatmap ──────────────────────────────────────────

const INSTA_DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const INSTA_DAY_ORDER  = [1, 2, 3, 4, 5, 6, 0]; // Mon→Sun

interface HeatmapCell { day: number; hour: number; value: number; }

function InstaHeatmap({ account }: { account: AcctFilter }) {
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [max, setMax]     = useState(1);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    const params = new URLSearchParams({ platform: 'instagram' });
    if (account !== 'all') params.set('account', account);
    apiFetch(`/api/post-metrics/heatmap?${params}`)
      .then(r => r.json())
      .then((d: { cells?: HeatmapCell[]; max?: number }) => {
        setCells(d.cells ?? []);
        setMax(d.max || 1);
      })
      .catch(() => setError(true));
  }, [account]);

  if (error) return <EmptyState msg="ヒートマップデータ取得失敗" />;

  const lookup = new Map<string, number>();
  cells.forEach(c => lookup.set(`${c.day}_${c.hour}`, c.value));
  const top3 = [...cells].sort((a, b) => b.value - a.value).slice(0, 3);

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(24, 1fr)', gap: 2, minWidth: 580 }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} style={{ textAlign: 'center', fontSize: 9, color: '#6b7280', lineHeight: 1.2 }}>
              {h % 6 === 0 ? h : ''}
            </div>
          ))}
          {INSTA_DAY_ORDER.map(day => (
            <Fragment key={day}>
              <div style={{ fontSize: 10, color: '#9ca3af', paddingRight: 6, display: 'flex', alignItems: 'center' }}>
                {INSTA_DAY_LABELS[day]}
              </div>
              {Array.from({ length: 24 }, (_, hour) => {
                const val       = lookup.get(`${day}_${hour}`) ?? 0;
                const intensity = max > 0 ? val / max : 0;
                return (
                  <div
                    key={hour}
                    title={`${INSTA_DAY_LABELS[day]}曜 ${hour}時: ${val.toLocaleString()}`}
                    style={{
                      height: 18,
                      borderRadius: 2,
                      backgroundColor: intensity > 0
                        ? `rgba(244,63,94,${Math.max(0.12, intensity)})`
                        : '#1a1a1a',
                    }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {top3.length > 0 ? (
        <p className="mt-2 text-[11px] text-neutral-300">
          🏆 {top3.map(c => `${INSTA_DAY_LABELS[c.day]}曜 ${c.hour}時`).join('、')}
        </p>
      ) : (
        <EmptyState msg="post_metrics データが溜まると表示されます" />
      )}
    </>
  );
}

// ── InstaHashtagChart ─────────────────────────────────────

interface InstaHashtagStat {
  hashtag:       string;
  post_count:    number;
  avg_reach:     number | null;
  avg_saves:     number | null;
  avg_save_rate: number | null;
}

function InstaHashtagChart({ account }: { account: AcctFilter }) {
  const [data, setData]   = useState<InstaHashtagStat[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    const param = account !== 'all' ? `?account=${encodeURIComponent(account)}` : '';
    apiFetch(`/api/instagram/hashtags${param}`)
      .then(r => r.json())
      .then((d: { data?: InstaHashtagStat[] }) => setData(d.data ?? []))
      .catch(() => setError(true));
  }, [account]);

  if (error) return <EmptyState msg="ハッシュタグデータ取得失敗" />;
  if (!data.length) return <EmptyState msg="ハッシュタグ付き投稿がありません（データ蓄積後に表示）" />;

  const chartData = data.map(d => ({
    name:       d.hashtag,
    '保存率(%)': d.avg_save_rate ?? 0,
  }));

  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 26)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis type="number" unit="%" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
          <YAxis type="category" dataKey="name" tick={{ ...CHART_STYLE, fill: '#9ca3af' }} width={90} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="保存率(%)" fill="#22c55e40" stroke="#22c55e" strokeWidth={1} radius={[0, 2, 2, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr>
            <TH>タグ</TH><TH>投稿数</TH><TH>平均リーチ</TH><TH>平均保存数</TH><TH>保存率</TH>
          </tr></thead>
          <tbody>{data.map((d, i) => (
            <tr key={i} className="hover:bg-neutral-800/30">
              <TD className="font-mono text-fuchsia-400">{d.hashtag}</TD>
              <TD>{d.post_count}</TD>
              <TD>{d.avg_reach?.toLocaleString() ?? '—'}</TD>
              <TD>{d.avg_saves?.toFixed(1) ?? '—'}</TD>
              <TD className="font-bold text-green-400">
                {d.avg_save_rate != null ? `${d.avg_save_rate.toFixed(2)}%` : '—'}
              </TD>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

export default function InstaTab() {
  const [sns, setSns]                   = useState<SnsMetric[]>([]);
  const [pm, setPm]                     = useState<PostMetric[]>([]);
  const [tokens, setTokens]             = useState<TokenInfo[]>([]);
  const [contentTypes, setContentTypes] = useState<ContentTypeStat[]>([]);
  const [buzzTypes, setBuzzTypes]       = useState<BuzzTypeStat[]>([]);
  const [acctFilter, setAcctFilter]     = useState<AcctFilter>('all');
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  // base data — fetched once
  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      apiFetch('/api/sns-metrics?platform=instagram&days=30', { signal: ctrl.signal }).then(r => r.json()),
      apiFetch('/api/post-metrics?platform=instagram&limit=300', { signal: ctrl.signal }).then(r => r.json()),
      apiFetch('/api/insta-token', { signal: ctrl.signal }).then(r => r.json()),
    ]).then(([s, p, t]) => {
      if (ctrl.signal.aborted) return;
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setTokens(t.tokens ?? []);
      setLoading(false);
    }).catch(e => {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) {
        console.error('[InstaTab]', e);
        setError('データの読み込みに失敗しました');
        setLoading(false);
      }
    });
    return () => ctrl.abort();
  }, []);

  // content-type stats — re-fetches when account filter changes
  useEffect(() => {
    const ctrl = new AbortController();
    const param = acctFilter !== 'all' ? `?account=${encodeURIComponent(acctFilter)}` : '';
    apiFetch(`/api/insta/content-type${param}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(c => { if (!ctrl.signal.aborted) setContentTypes(c.data ?? []); })
      .catch(e => {
        const isAbort = e instanceof DOMException && e.name === 'AbortError';
        if (!isAbort) console.error('[InstaTab/content-type]', e);
      });
    apiFetch(`/api/instagram/buzz-type${param}`, { signal: ctrl.signal }).then(r => r.json())
      .then(d => { if (!ctrl.signal.aborted && Array.isArray(d.data)) setBuzzTypes(d.data); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [acctFilter]);

  const filteredSns    = acctFilter !== 'all' ? sns.filter(m => m.account === acctFilter)    : sns;
  const filteredPm     = acctFilter !== 'all' ? pm.filter(m => m.account === acctFilter)     : pm;
  const filteredTokens = acctFilter !== 'all' ? tokens.filter(t => t.account === acctFilter) : tokens;

  const { data: followerData, accounts } = pivotByAccount(filteredSns, 'followers');
  const { data: reachData }              = pivotByAccount(filteredSns, 'reach');
  const latestFollowers = latestByAccount(filteredSns, 'followers');

  const savesMap  = Object.fromEntries(filteredPm.filter(m => m.metric_key === 'saves').map(m => [m.post_id, m.value]));
  const reachMap  = Object.fromEntries(filteredPm.filter(m => m.metric_key === 'reach').map(m => [m.post_id, m.value]));
  const saveRates = Object.keys(savesMap)
    .filter(id => reachMap[id] && reachMap[id] > 0)
    .map(id => ({
      post_id: id.slice(0, 16),
      saveRate: parseFloat(((savesMap[id] / reachMap[id]) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.saveRate - a.saveRate)
    .slice(0, 10);

  const buzzBarData = filteredSns
    .filter(m => m.metric_key === 'avgScore')
    .map(m => ({ account: m.account, score: m.value }));

  const expiredOrWarn = filteredTokens.filter(t => t.status === 'expired' || t.status === 'warn');

  const ctBarData = contentTypes.map(c => ({
    name: c.content_type,
    保存率: c.avg_save_rate ?? 0,
    平均リーチ: c.avg_reach ?? 0,
  }));

  const FOLLOWER_WEEK_GOAL = 200;
  const SAVE_RATE_GOAL     = 8.0;

  const buzzTypeBarData = buzzTypes.map(b => ({
    name:       b.buzz_type,
    平均リーチ:  b.avg_reach    ?? 0,
    平均保存数:  b.avg_saves    ?? 0,
    '保存率(%)': b.save_rate_pct ?? 0,
  }));

  const weeklyFollowerGain = (() => {
    if (followerData.length < 2) return null;
    const last  = followerData[followerData.length - 1] as Record<string, unknown>;
    const prev  = (followerData.length >= 8 ? followerData[followerData.length - 8] : followerData[0]) as Record<string, unknown>;
    const lastSum = accounts.reduce((s, a) => s + (Number(last[a]) || 0), 0);
    const prevSum = accounts.reduce((s, a) => s + (Number(prev[a]) || 0), 0);
    return lastSum - prevSum;
  })();

  const weekAvgSaveRate = saveRates.length > 0
    ? parseFloat((saveRates.reduce((s, r) => s + r.saveRate, 0) / saveRates.length).toFixed(2))
    : null;

  if (error) return <EmptyState msg={error} />;
  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
      {/* account filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {INSTA_ACCOUNTS.map(a => (
          <button
            key={a}
            onClick={() => setAcctFilter(a)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              acctFilter === a
                ? 'bg-fuchsia-700 text-white'
                : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
            }`}
          >
            {a === 'all' ? '全体' : a}
          </button>
        ))}
      </div>

      {expiredOrWarn.length > 0 && (
        <div className="mb-3 p-3 rounded-lg border border-red-800 bg-red-950/30">
          <span className="text-red-400 text-xs font-bold">🔑 トークン期限警告</span>
          {expiredOrWarn.map(t => (
            <div key={t.account} className="text-xs text-red-300 mt-1">
              {t.account}: {t.status === 'expired' ? '期限切れ' : `残${t.daysLeft}日`} — check-expiry.js を実行してください
            </div>
          ))}
        </div>
      )}

      <KpiGrid items={[
        [Object.values(latestFollowers).reduce((s, v) => s + v, 0) || '—', '合計フォロワー'],
        [saveRates.length || '—', '保存率計測済み投稿数'],
        [saveRates[0]?.saveRate ?? '—', '最高保存率(%)'],
        [accounts.length || '—', 'トラッキングアカウント数'],
      ]} />

      <Section title="トークン有効期限">
        {filteredTokens.length ? (
          <div className="grid grid-cols-3 gap-3">
            {filteredTokens.map(t => (
              <div key={t.account} className={`rounded-lg p-3 border ${
                t.status === 'expired' ? 'border-red-800 bg-red-950/30'
                : t.status === 'warn'  ? 'border-amber-800 bg-amber-950/30'
                : t.status === 'ok'    ? 'border-green-800 bg-green-950/20'
                : 'border-neutral-700 bg-neutral-800/20'
              }`}>
                <div className="text-xs font-semibold text-neutral-300">{t.account}</div>
                <div className={`text-lg font-bold mt-1 ${
                  t.status === 'expired' ? 'text-red-400'
                  : t.status === 'warn'  ? 'text-amber-400'
                  : t.status === 'ok'    ? 'text-green-400'
                  : 'text-neutral-500'
                }`}>
                  {t.status === 'unknown' ? '不明' : t.status === 'expired' ? '期限切れ' : `残${t.daysLeft}日`}
                </div>
                {t.expiresAt && (
                  <div className="text-[10px] text-neutral-500 mt-0.5">{fmtTs(t.expiresAt)}</div>
                )}
              </div>
            ))}
          </div>
        ) : <EmptyState />}
      </Section>

      <Section title="Reels vs 静止画 パフォーマンス比較">
        {contentTypes.length ? (
          <>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {contentTypes.map(c => (
                <div key={c.content_type} className="rounded-lg border border-neutral-700 bg-neutral-800/30 p-4">
                  <div className="text-sm font-semibold text-neutral-200 mb-3">
                    {c.content_type === 'Reels' ? '🎬 Reels' : '🖼 静止画'}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-neutral-500">投稿数</div>
                      <div className="text-neutral-100 font-medium">{c.post_count}</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">平均リーチ</div>
                      <div className="text-neutral-100 font-medium">{c.avg_reach?.toFixed(0) ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">平均保存数</div>
                      <div className="text-neutral-100 font-medium">{c.avg_saves?.toFixed(1) ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">平均保存率</div>
                      <div className="text-green-400 font-bold">{c.avg_save_rate?.toFixed(2) ?? '—'}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={ctBarData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                <XAxis dataKey="name" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis yAxisId="left" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                <Bar yAxisId="left" dataKey="保存率" fill="#22c55e40" stroke="#22c55e" strokeWidth={1} unit="%" />
                <Bar yAxisId="right" dataKey="平均リーチ" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} />
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : <EmptyState />}
      </Section>

      <Section title="保存率ランキング（最重要指標）">
        {saveRates.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={saveRates} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis type="number" unit="%" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis type="category" dataKey="post_id" width={120} tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => [`${v}%`, '保存率']} />
              <Bar dataKey="saveRate" fill="#22c55e40" stroke="#22c55e" strokeWidth={1} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </Section>

      <Section title="フォロワー推移（30日）">
        {followerData.length ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={followerData}>
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

      <Section title="週次リーチ数推移">
        {reachData.length ? (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={reachData}>
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

      <Section title="content-reviewer スコア分布">
        {buzzBarData.length ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={buzzBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="account" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis domain={[0, 10]} tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="score" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </Section>

      {/* ── Heatmap ────────────────────────────────────── */}
      <Section title="最適投稿時間帯ヒートマップ（Instagram · 直近90日）">
        <InstaHeatmap account={acctFilter} />
      </Section>

      {/* ── Hashtag engagement ─────────────────────────── */}
      <Section title="ハッシュタグ別エンゲージメント（保存率順 Top10）">
        <InstaHashtagChart account={acctFilter} />
      </Section>

      {/* ── Buzz Type A/B ─────────────────────────────── */}
      <Section title="バズ型 A/B比較（投稿コンテンツ分類別パフォーマンス）">
        {buzzTypes.length ? (
          <>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={buzzTypeBarData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                <XAxis dataKey="name" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis yAxisId="left" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis yAxisId="right" orientation="right" unit="%" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                <Bar yAxisId="left"  dataKey="平均リーチ"  fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} />
                <Bar yAxisId="left"  dataKey="平均保存数"  fill="#22c55e40" stroke="#22c55e" strokeWidth={1} />
                <Bar yAxisId="right" dataKey="保存率(%)" fill="#f59e0b40" stroke="#f59e0b" strokeWidth={1} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  <TH>バズ型</TH><TH>投稿数</TH><TH>平均リーチ</TH><TH>平均保存数</TH><TH>保存率</TH>
                </tr></thead>
                <tbody>{buzzTypes.map((b, i) => (
                  <tr key={i} className="hover:bg-neutral-800/30">
                    <TD className="font-medium">{b.buzz_type}</TD>
                    <TD>{b.post_count}</TD>
                    <TD>{b.avg_reach?.toLocaleString() ?? '—'}</TD>
                    <TD>{b.avg_saves?.toFixed(1) ?? '—'}</TD>
                    <TD className="font-bold text-amber-400">
                      {b.save_rate_pct != null ? `${b.save_rate_pct.toFixed(2)}%` : '—'}
                    </TD>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>
        ) : <EmptyState msg="投稿が蓄積されると表示されます" />}
      </Section>

      {/* ── Weekly Scorecard ──────────────────────────── */}
      <Section title="週次スコアカード">
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-neutral-700 bg-neutral-800/30 p-4">
            <div className="text-xs text-neutral-400 mb-1">フォロワー週次増加</div>
            <div className="text-2xl font-bold text-fuchsia-400">
              {weeklyFollowerGain != null
                ? (weeklyFollowerGain >= 0 ? `+${weeklyFollowerGain}` : `${weeklyFollowerGain}`)
                : '—'}
            </div>
            <div className="text-[10px] text-neutral-500 mb-2">目標: +{FOLLOWER_WEEK_GOAL}</div>
            {weeklyFollowerGain != null && (
              <div className="w-full bg-neutral-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${weeklyFollowerGain >= FOLLOWER_WEEK_GOAL ? 'bg-green-500' : 'bg-fuchsia-500'}`}
                  style={{ width: `${Math.min(100, Math.max(0, (weeklyFollowerGain / FOLLOWER_WEEK_GOAL) * 100))}%` }}
                />
              </div>
            )}
            <div className="text-[10px] text-neutral-500 mt-1">
              {weeklyFollowerGain != null
                ? `${Math.round((weeklyFollowerGain / FOLLOWER_WEEK_GOAL) * 100)}% 達成`
                : 'データ不足'}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-700 bg-neutral-800/30 p-4">
            <div className="text-xs text-neutral-400 mb-1">保存率（計測済み投稿平均）</div>
            <div className="text-2xl font-bold text-green-400">
              {weekAvgSaveRate != null ? `${weekAvgSaveRate}%` : '—'}
            </div>
            <div className="text-[10px] text-neutral-500 mb-2">目標: {SAVE_RATE_GOAL}%</div>
            {weekAvgSaveRate != null && (
              <div className="w-full bg-neutral-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${weekAvgSaveRate >= SAVE_RATE_GOAL ? 'bg-green-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, (weekAvgSaveRate / SAVE_RATE_GOAL) * 100)}%` }}
                />
              </div>
            )}
            <div className="text-[10px] text-neutral-500 mt-1">
              {weekAvgSaveRate != null
                ? `${Math.round((weekAvgSaveRate / SAVE_RATE_GOAL) * 100)}% 達成`
                : 'データ不足'}
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
