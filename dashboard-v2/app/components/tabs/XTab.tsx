'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';
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

// ── types ──────────────────────────────────────────────────

interface XPost {
  id: number;
  platform: string;
  account: string | null;
  content: string | null;
  status: string;
  error_msg: string | null;
  created_at: string;
}

interface ContentTypeStat {
  content_type: string;
  post_count: number;
  avg_impressions: number | null;
  avg_er_pct: number | null;
}

const X_ACCOUNTS = ['all', 'rascal_ai_devops', 'invest', 'affiliate'] as const;
type AcctFilter = (typeof X_ACCOUNTS)[number];

// ── ContentTypeChart ──────────────────────────────────────

function ContentTypeChart({ account }: { account: AcctFilter }) {
  const [data, setData]   = useState<ContentTypeStat[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    const url = account !== 'all'
      ? `/api/x/content-type?account=${encodeURIComponent(account)}`
      : '/api/x/content-type';
    apiFetch(url).then(r => r.json())
      .then(d => setData((d.data as ContentTypeStat[]) ?? []))
      .catch(e => { console.error('[ContentTypeChart] fetch failed', e); setError(true); });
  }, [account]);

  if (error) return <EmptyState msg="コンテンツ型データの取得に失敗しました" />;
  if (!data.length) {
    return <EmptyState msg="投稿データなし — posts.published_at が入力されると表示" />;
  }

  const barData = data.map(d => ({
    name: d.content_type,
    投稿数: d.post_count,
    平均インプレ: d.avg_impressions ?? 0,
    '平均ER(%)': d.avg_er_pct ?? 0,
  }));

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={barData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis dataKey="name" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
          <YAxis yAxisId="left" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
          <YAxis yAxisId="right" orientation="right" unit="%" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
          <Bar yAxisId="left" dataKey="平均インプレ"
            fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} radius={[2, 2, 0, 0]} />
          <Bar yAxisId="right" dataKey="平均ER(%)"
            fill="#22c55e40" stroke="#22c55e" strokeWidth={1} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex gap-4">
        {data.map(d => (
          <div key={d.content_type} className="text-[11px] text-neutral-500">
            <span className="text-neutral-300 font-semibold">{d.content_type}</span>
            {' '}— {d.post_count}件
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-neutral-600">
        ※ ER = likes / impressions。投稿と計測データを時間近似で紐付け（β）
      </p>
    </>
  );
}

// ── XTab ──────────────────────────────────────────────────

export default function XTab() {
  const [sns, setSns]               = useState<SnsMetric[]>([]);
  const [pm, setPm]                 = useState<PostMetric[]>([]);
  const [xPosts, setXPosts]         = useState<XPost[]>([]);
  const [acctFilter, setAcctFilter] = useState<AcctFilter>('all');
  const [retrying, setRetrying]     = useState<number | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);

  const loadPosts = useCallback(() =>
    apiFetch('/api/posts?platform=x&limit=30').then(r => r.json())
      .then(d => setXPosts(d.posts ?? []))
      .catch(() => {}),
  []);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      apiFetch('/api/sns-metrics?platform=x&days=30', { signal: ctrl.signal }).then(r => r.json()),
      apiFetch('/api/post-metrics?platform=x&limit=100', { signal: ctrl.signal }).then(r => r.json()),
      apiFetch('/api/posts?platform=x&limit=30', { signal: ctrl.signal }).then(r => r.json()),
    ]).then(([s, p, xp]) => {
      if (ctrl.signal.aborted) return;
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setXPosts(xp.posts ?? []);
      setLoading(false);
    }).catch(e => {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) {
        console.error('[XTab] initial load failed', e);
        setLoading(false);
      }
    });
    return () => ctrl.abort();
  }, []);

  // ── filtered views by account ───────────────────────────
  const filteredSns   = acctFilter !== 'all' ? sns.filter(m => m.account === acctFilter)   : sns;
  const filteredPm    = acctFilter !== 'all' ? pm.filter(m => m.account === acctFilter)    : pm;
  const filteredPosts = acctFilter !== 'all' ? xPosts.filter(p => p.account === acctFilter) : xPosts;

  const { data: followerData, accounts } = pivotByAccount(filteredSns, 'followers');
  const latest = latestByAccount(filteredSns, 'followers');

  const erData = ['promoAvgER', 'normalAvgER'].flatMap(key =>
    filteredSns.filter(m => m.metric_key === key).map(m => ({
      date: m.recorded_at.slice(0, 10),
      label: key === 'promoAvgER' ? 'プロモ' : '通常',
      value: m.value,
    }))
  );
  const erBarData = Object.entries(
    erData.reduce<Record<string, Record<string, number>>>((acc, r) => ({
      ...acc, [r.date]: { ...(acc[r.date] ?? {}), [r.label]: r.value },
    }), {})
  ).sort().slice(-7).map(([date, vals]) => ({ date, ...vals }));

  const postImpressions = filteredPm
    .filter(m => m.metric_key === 'impressions' && m.snapshot_at === 'total')
    .slice()
    .sort((a, b) => b.value - a.value);
  const topPosts = postImpressions.slice(0, 10);

  const failedPosts = filteredPosts.filter(p => p.status === 'failed');

  async function retry(id: number) {
    setRetrying(id);
    setRetryError(null);
    try {
      const r = await apiFetch(`/api/posts/${id}/retry`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        setRetryError(d.error ?? `HTTP ${r.status}`);
      } else {
        await loadPosts();
      }
    } catch (e) {
      setRetryError((e as Error).message ?? '再試行失敗');
    }
    setRetrying(null);
  }

  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
      {/* ── Account filter ─────────────────────────────── */}
      <div className="flex gap-1.5 mb-3">
        {X_ACCOUNTS.map(a => (
          <button
            key={a}
            onClick={() => setAcctFilter(a)}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
              acctFilter === a
                ? 'border-violet-700 bg-violet-950 text-violet-300'
                : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
            }`}
          >
            {a === 'all' ? '全体' : `@${a}`}
          </button>
        ))}
      </div>

      <KpiGrid items={[
        [accounts.length || '—', 'トラッキング中アカウント数'],
        [Object.values(latest).reduce((s, v) => s + v, 0) || '—', '合計フォロワー(最新)'],
        [postImpressions.length || '—', '計測済み投稿数'],
        [failedPosts.length || 0, '失敗投稿', failedPosts.length ? 'text-red-400' : ''],
      ]} />

      {failedPosts.length > 0 && (
        <Section title={`エラーログ — 失敗投稿 ${failedPosts.length}件`}>
          {retryError && (
            <div className="mb-2 p-2 text-xs text-red-400 bg-red-950/30 rounded border border-red-800">
              再試行エラー: {retryError}
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>アカウント</TH><TH>内容</TH><TH>エラー</TH><TH>日時</TH><TH>操作</TH>
              </tr></thead>
              <tbody>{failedPosts.map(p => (
                <tr key={p.id} className="hover:bg-neutral-800/30">
                  <TD>{p.account ?? '—'}</TD>
                  <TD className="max-w-[160px]">
                    <span className="truncate block">{p.content?.slice(0, 40) ?? '—'}</span>
                  </TD>
                  <TD className="max-w-[200px]">
                    <span className="truncate block text-red-400 text-[10px]">
                      {p.error_msg?.slice(0, 60) ?? '—'}
                    </span>
                  </TD>
                  <TD>{fmtTs(p.created_at)}</TD>
                  <TD>
                    <button
                      onClick={() => retry(p.id)}
                      disabled={retrying === p.id}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold border border-blue-800 bg-blue-950 text-blue-400 hover:bg-blue-900 disabled:opacity-50"
                    >
                      {retrying === p.id ? '...' : '↻ 再試行'}
                    </button>
                  </TD>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="フォロワー推移（30日）">
        {followerData.length ? (
          <ResponsiveContainer width="100%" height={200}>
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

      <Section title="週次エンゲージメント率比較">
        {erBarData.length ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={erBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="date" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              <Bar dataKey="プロモ" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} />
              <Bar dataKey="通常"   fill="#22c55e40" stroke="#22c55e" strokeWidth={1} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState />}
      </Section>

      <Section title="投稿別インプレッション Top10">
        {topPosts.length ? (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>post_id</TH><TH>アカウント</TH><TH>インプレッション</TH><TH>記録日</TH>
              </tr></thead>
              <tbody>{topPosts.map(p => (
                <tr key={p.id} className="hover:bg-neutral-800/30">
                  <TD className="font-mono">{p.post_id.slice(0, 20)}</TD>
                  <TD>{p.account ?? '—'}</TD>
                  <TD>{p.value.toLocaleString()}</TD>
                  <TD>{fmtTs(p.recorded_at)}</TD>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>

      {/* ── Content type breakdown ─────────────────────── */}
      <Section title="コンテンツ型別エンゲージメント（β）">
        <ContentTypeChart account={acctFilter} />
      </Section>
    </>
  );
}
