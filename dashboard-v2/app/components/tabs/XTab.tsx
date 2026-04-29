'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
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

interface VelocityPost {
  id: number;
  content_preview: string;
  account: string | null;
  hours_since: number;
  impressions: number;
  likes: number;
  retweets: number;
  velocity: number;
}

interface ContentTypeStat {
  content_type: string;
  post_count: number;
  avg_impressions: number | null;
  avg_er_pct: number | null;
}

interface HashtagStat {
  hashtag: string;
  post_count: number;
  avg_impressions: number | null;
  avg_er_pct: number | null;
}

interface NoteCtrRow {
  has_link: boolean;
  post_count: number;
  avg_er_pct: number | null;
  avg_impressions: number | null;
}

interface HeatmapCell {
  day: number;
  hour: number;
  value: number;
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

// ── XHeatmap ─────────────────────────────────────────────

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_ORDER  = [1, 2, 3, 4, 5, 6, 0]; // Mon→Sun

function XHeatmap() {
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [max, setMax]     = useState(1);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiFetch('/api/post-metrics/heatmap?platform=x')
      .then(r => r.json())
      .then((d: { cells?: HeatmapCell[]; max?: number }) => {
        setCells(d.cells ?? []);
        setMax(d.max || 1);
      })
      .catch(() => setError(true));
  }, []);

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
          {DAY_ORDER.map(day => (
            <Fragment key={day}>
              <div style={{ fontSize: 10, color: '#9ca3af', paddingRight: 6, display: 'flex', alignItems: 'center' }}>
                {DAY_LABELS[day]}
              </div>
              {Array.from({ length: 24 }, (_, hour) => {
                const val = lookup.get(`${day}_${hour}`) ?? 0;
                const intensity = max > 0 ? val / max : 0;
                return (
                  <div
                    key={hour}
                    title={`${DAY_LABELS[day]}曜 ${hour}時: ${val.toLocaleString()}`}
                    style={{
                      height: 18,
                      borderRadius: 2,
                      backgroundColor: intensity > 0
                        ? `rgba(99,102,241,${Math.max(0.12, intensity)})`
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
          🏆 {top3.map(c => `${DAY_LABELS[c.day]}曜 ${c.hour}時`).join('、')}
        </p>
      ) : (
        <EmptyState msg="post_metrics データが溜まると表示されます" />
      )}
    </>
  );
}

// ── HashtagChart ──────────────────────────────────────────

function HashtagChart() {
  const [data, setData]   = useState<HashtagStat[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiFetch('/api/x/hashtags')
      .then(r => r.json())
      .then((d: { data?: HashtagStat[] }) => setData(d.data ?? []))
      .catch(() => setError(true));
  }, []);

  if (error) return <EmptyState msg="ハッシュタグデータ取得失敗" />;
  if (!data.length) return <EmptyState msg="ハッシュタグ付き投稿がありません（データ蓄積後に表示）" />;

  const chartData = data.map(d => ({
    name:      d.hashtag,
    平均インプレ: d.avg_impressions ?? 0,
    '平均ER(%)': d.avg_er_pct ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 26)}>
      <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
        <XAxis type="number" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
        <YAxis type="category" dataKey="name" tick={{ ...CHART_STYLE, fill: '#9ca3af' }} width={90} />
        <Tooltip {...TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
        <Bar dataKey="平均インプレ" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} radius={[0, 2, 2, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── NoteCtrSection ────────────────────────────────────────

function NoteCtrSection() {
  const [data, setData]   = useState<NoteCtrRow[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiFetch('/api/x/note-ctr')
      .then(r => r.json())
      .then((d: { data?: NoteCtrRow[] }) => setData(d.data ?? []))
      .catch(() => setError(true));
  }, []);

  if (error) return <EmptyState msg="note誘導CTRデータ取得失敗" />;

  const linkRow   = data.find(d => d.has_link);
  const noLinkRow = data.find(d => !d.has_link);
  const ctr       = linkRow?.avg_er_pct ?? null;

  const chartData = [
    { name: 'リンク付き', '平均ER(%)': linkRow?.avg_er_pct   ?? 0 },
    { name: 'リンクなし', '平均ER(%)': noLinkRow?.avg_er_pct ?? 0 },
  ];

  return (
    <>
      <div className="mb-3 inline-block p-3 rounded-lg border border-neutral-700 bg-neutral-900/60">
        <div className="text-[10px] text-neutral-500 mb-0.5">note誘導CTR（直近30日 · ER代理指標）</div>
        <div className="text-2xl font-bold text-violet-400">
          {ctr !== null ? `${ctr.toFixed(1)}%` : '—'}
        </div>
        {linkRow && (
          <div className="text-[10px] text-neutral-500 mt-0.5">
            リンク付き投稿 {linkRow.post_count}件
          </div>
        )}
      </div>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={chartData} margin={{ top: 4, right: 30, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
            <XAxis dataKey="name" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
            <YAxis unit="%" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar dataKey="平均ER(%)" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState msg="直近30日の投稿データがありません" />
      )}
      <p className="mt-1 text-[10px] text-neutral-600">
        ※ CTR代理指標: note.com/http含む投稿のER。link_clicks計測データがあれば実CTRに切り替わります
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
  const [velocity, setVelocity]     = useState<VelocityPost[]>([]);

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
    apiFetch('/api/x/velocity', { signal: ctrl.signal }).then(r => r.json())
      .then(d => { if (Array.isArray(d.posts)) setVelocity(d.posts); }).catch(() => {});

    return () => ctrl.abort();
  }, []);

  // ── thread detection (🧵 or N/M pattern) ───────────────
  const THREAD_RE = /(?:^|\s)(?:🧵|\d+[/／]\d+)/;
  const postEngMap: Record<number, { imp: number; likes: number; rt: number }> = {};
  pm.forEach(m => {
    const id = Number(m.post_id);
    if (!postEngMap[id]) postEngMap[id] = { imp: 0, likes: 0, rt: 0 };
    if (m.metric_key === 'impressions') postEngMap[id].imp   = m.value;
    if (m.metric_key === 'likes')       postEngMap[id].likes = m.value;
    if (m.metric_key === 'retweets')    postEngMap[id].rt    = m.value;
  });
  const threadGroups = { thread: { imp: 0, likes: 0, rt: 0, n: 0 }, single: { imp: 0, likes: 0, rt: 0, n: 0 } };
  xPosts.forEach(p => {
    const type = p.content && THREAD_RE.test(p.content) ? 'thread' : 'single';
    const eng  = postEngMap[p.id];
    if (eng) {
      threadGroups[type].imp   += eng.imp;
      threadGroups[type].likes += eng.likes;
      threadGroups[type].rt    += eng.rt;
    }
    threadGroups[type].n++;
  });
  const threadBarData = (['impressions', 'likes', 'retweets'] as const).map(key => {
    const tN = threadGroups.thread.n || 1;
    const sN = threadGroups.single.n || 1;
    const metricKey = key === 'impressions' ? 'imp' : key === 'likes' ? 'likes' : 'rt';
    return {
      metric: key === 'impressions' ? 'IMP' : key === 'likes' ? 'いいね' : 'RT',
      スレッド: parseFloat((threadGroups.thread[metricKey] / tN).toFixed(1)),
      単体:     parseFloat((threadGroups.single[metricKey] / sN).toFixed(1)),
    };
  });
  const hasThreadData = xPosts.length > 0 && pm.length > 0;

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

      {/* ── Heatmap ────────────────────────────────────── */}
      <Section title="最適投稿時間帯ヒートマップ（X · 直近90日）">
        <XHeatmap />
      </Section>

      {/* ── Hashtag engagement ─────────────────────────── */}
      <Section title="ハッシュタグ別エンゲージメント Top15">
        <HashtagChart />
      </Section>

      {/* ── Note CTR ───────────────────────────────────── */}
      <Section title="note誘導CTR（リンク付き投稿 vs リンクなし）">
        <NoteCtrSection />
      </Section>

      {/* ── P2: 2h velocity ────────────────────────────── */}
      <Section title="投稿後速度スコア Top10（直近48h · eng/h）">
        {velocity.length ? (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>経過h</TH><TH>IMP</TH><TH>いいね</TH><TH>RT</TH>
                <TH>速度スコア</TH><TH>投稿プレビュー</TH>
              </tr></thead>
              <tbody>{velocity.slice(0, 10).map(p => (
                <tr key={p.id} className="hover:bg-neutral-800/30">
                  <TD className="font-mono text-[11px]">{p.hours_since}h</TD>
                  <TD className="font-mono">{p.impressions.toLocaleString()}</TD>
                  <TD className="font-mono">{p.likes.toLocaleString()}</TD>
                  <TD className="font-mono">{p.retweets.toLocaleString()}</TD>
                  <TD className="font-bold text-blue-400 font-mono">{p.velocity.toLocaleString()}</TD>
                  <TD className="text-[11px] text-neutral-400 max-w-[200px] truncate">
                    {p.content_preview || '—'}
                  </TD>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs py-6 text-center text-neutral-500">直近48h以内の投稿データが蓄積後に表示</p>
        )}
      </Section>

      {/* ── P2: Thread vs single ───────────────────────── */}
      <Section title="スレッド vs 単体ツイート 平均エンゲージメント比較">
        {hasThreadData ? (
          <>
            <p className="text-[10px] text-neutral-500 mb-2">
              スレッド: {threadGroups.thread.n}件 / 単体: {threadGroups.single.n}件
              （検出: 🧵・N/M パターン）
            </p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={threadBarData} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                <XAxis dataKey="metric" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10, color: '#6b7280' }} />
                <Bar dataKey="スレッド" fill="#3b82f640" stroke="#3b82f6" strokeWidth={1} radius={[2,2,0,0]} />
                <Bar dataKey="単体"     fill="#22c55e40" stroke="#22c55e" strokeWidth={1} radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <p className="text-xs py-6 text-center text-neutral-500">post_metrics 蓄積後に表示</p>
        )}
      </Section>
    </>
  );
}
