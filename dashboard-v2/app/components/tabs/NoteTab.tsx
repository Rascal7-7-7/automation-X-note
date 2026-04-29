'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Section, KpiGrid, EmptyState, Spinner, TH, TD,
  SnsMetric, PostMetric,
  pivotByAccount, latestByAccount,
  CHART_STYLE, LINE_COLORS, TOOLTIP_STYLE, fmtTs,
} from '../ui';

// ── types ──────────────────────────────────────────────────

interface Draft {
  id: string;
  account: string;
  title: string;
  createdAt: string;
  hasCoverImage: boolean;
  publishedUrl: string | null;
  status: 'draft' | 'published';
}

interface DraftStats {
  total: number;
  noCover: number;
  published: number;
  draft: number;
}

interface CuratorEntry {
  date: string;
  curator: string;
  articleTitle: string;
  url: string;
}

// ── helpers ────────────────────────────────────────────────

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : null;
  } catch { return null; }
}

function extractNoteKey(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/n\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

function classifyNoteTitle(title: string): string {
  const t = title.normalize('NFKC');
  if (/AI|Claude|自動化/.test(t))              return 'AI系';
  if (/副業|収益|稼ぐ/.test(t))                return '副業系';
  if (/サーバー|ドメイン|WordPress/.test(t))   return 'インフラ系';
  return 'その他';
}

// ── NoteSalesSection ──────────────────────────────────────

interface SalesDraft {
  title: string;
  price: number;
  sales_count: number;
  revenue: number;
  status: string;
  accountId: number;
  noteUrl: string | null;
}

interface SalesResponse {
  articles: SalesDraft[];
  summary: { paid_count: number; total_revenue: number; avg_price: number };
}

function NoteSalesSection() {
  const [data, setData]   = useState<SalesResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiFetch('/api/note-sales')
      .then(r => r.json())
      .then((d: SalesResponse) => setData(d))
      .catch(() => setError(true));
  }, []);

  if (error) return <EmptyState msg="売上データの取得に失敗しました" />;
  if (!data)  return <Spinner />;

  const { articles, summary } = data;

  if (!articles.length) {
    return (
      <p className="text-xs text-center text-neutral-500 py-6">
        売上データはまだありません（note決済連携後に表示）
      </p>
    );
  }

  return (
    <>
      <KpiGrid items={[
        [summary.paid_count,                              '有料記事数'],
        [`¥${summary.total_revenue.toLocaleString()}`,    '総売上'],
        [`¥${summary.avg_price.toLocaleString()}`,        '平均単価'],
      ]} />
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table className="w-full border-collapse mt-2">
          <thead><tr>
            <TH>タイトル</TH><TH>価格</TH><TH>販売数</TH><TH>売上</TH><TH>状態</TH>
          </tr></thead>
          <tbody>{articles.map((a, i) => (
            <tr key={i} className={`hover:bg-neutral-800/30 ${a.revenue === 0 ? 'opacity-40' : ''}`}>
              <TD className="max-w-[200px]">
                {safeUrl(a.noteUrl) ? (
                  <a href={safeUrl(a.noteUrl)!} target="_blank" rel="noopener noreferrer"
                    className="text-violet-400 hover:underline truncate block">
                    {a.title.slice(0, 35)}
                  </a>
                ) : (
                  <span className="truncate block">{a.title.slice(0, 35)}</span>
                )}
              </TD>
              <TD className="font-mono">¥{a.price.toLocaleString()}</TD>
              <TD className="text-center font-bold">{a.sales_count}</TD>
              <TD className="font-mono text-green-400">
                {a.revenue > 0 ? `¥${a.revenue.toLocaleString()}` : '—'}
              </TD>
              <TD>
                <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                  a.status === 'posted' || a.status === 'published'
                    ? 'bg-green-950 text-green-400 border-green-800'
                    : 'bg-neutral-800 text-neutral-400 border-neutral-600'
                }`}>{a.status}</span>
              </TD>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

// ── NoteReferrerSection ───────────────────────────────────

function NoteReferrerSection({ pm }: { pm: PostMetric[] }) {
  const referrerMetrics = pm.filter(m => m.metric_key.startsWith('referrer_') && m.snapshot_at === 'total');

  if (!referrerMetrics.length) {
    return (
      <p className="text-xs text-center text-neutral-500 py-6">
        流入元データなし（note Analytics連携後に表示）
      </p>
    );
  }

  const agg: Record<string, number> = {};
  referrerMetrics.forEach(m => {
    const k = m.metric_key.replace('referrer_', '');
    agg[k] = (agg[k] ?? 0) + m.value;
  });

  const chartData = Object.entries(agg)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const postIds = [...new Set(referrerMetrics.map(m => m.post_id))];
  const refKeys = [...new Set(referrerMetrics.map(m => m.metric_key.replace('referrer_', '')))];

  type ArticleRow = { postId: string; breakdown: Record<string, number>; total: number };
  const articleRows: ArticleRow[] = postIds
    .map(postId => {
      const rows = referrerMetrics.filter(m => m.post_id === postId);
      const breakdown: Record<string, number> = {};
      rows.forEach(r => { breakdown[r.metric_key.replace('referrer_', '')] = r.value; });
      return { postId, breakdown, total: rows.reduce((s, r) => s + r.value, 0) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 32)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
          <XAxis type="number" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
          <YAxis type="category" dataKey="name" width={80} tick={{ ...CHART_STYLE, fill: '#9ca3af' }} />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar dataKey="value" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} radius={[0, 2, 2, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {articleRows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <TH>記事ID</TH>
              {refKeys.map(k => <TH key={k}>{k}</TH>)}
              <TH>合計</TH>
            </tr></thead>
            <tbody>{articleRows.map((a, i) => (
              <tr key={i} className="hover:bg-neutral-800/30">
                <TD className="font-mono text-[10px]">{a.postId.slice(0, 20)}</TD>
                {refKeys.map(k => <TD key={k}>{a.breakdown[k] ?? 0}</TD>)}
                <TD className="font-bold">{a.total}</TD>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── NoteTab ────────────────────────────────────────────────

export default function NoteTab() {
  const [sns, setSns]               = useState<SnsMetric[]>([]);
  const [pm, setPm]                 = useState<PostMetric[]>([]);
  const [drafts, setDrafts]         = useState<Draft[]>([]);
  const [draftStats, setDraftStats] = useState<DraftStats>({ total: 0, noCover: 0, published: 0, draft: 0 });
  const [curatorHistory, setCuratorHistory] = useState<CuratorEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [monthlyRevenue, setMonthlyRevenue] = useState<{ month: string; revenue: number }[]>([]);
  const [curatorImpact, setCuratorImpact]   = useState<Array<CuratorEntry & { pvBefore: number | null; pvAfter: number | null; pvGrowthPct: number | null }>>([]);

  // publish flow state
  const [confirmDraft, setConfirmDraft]   = useState<Draft | null>(null);
  const [publishing, setPublishing]       = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<Record<string, string>>({});
  const [publishError, setPublishError]   = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch('/api/note/monthly-revenue', { signal: ctrl.signal }).then(r => r.json())
      .then(d => { if (Array.isArray(d.series)) setMonthlyRevenue(d.series); }).catch(() => {});
    apiFetch('/api/note/curator-pv-impact', { signal: ctrl.signal }).then(r => r.json())
      .then(d => { if (Array.isArray(d.entries)) setCuratorImpact(d.entries); }).catch(() => {});

    Promise.all([
      apiFetch('/api/sns-metrics?platform=note&days=30', { signal: ctrl.signal }).then(r => r.json()),
      apiFetch('/api/post-metrics?platform=note&limit=200', { signal: ctrl.signal }).then(r => r.json()),
      apiFetch('/api/note-drafts', { signal: ctrl.signal }).then(r => r.json()),
      apiFetch('/api/note-curator-history', { signal: ctrl.signal }).then(r => r.json()),
    ]).then(([s, p, nd, ch]) => {
      if (ctrl.signal.aborted) return;
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setDrafts(nd.drafts ?? []);
      setDraftStats(nd.stats ?? { total: 0, noCover: 0, published: 0, draft: 0 });
      setCuratorHistory(ch.history ?? []);
      setLoading(false);
    }).catch(e => {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) {
        console.error('[NoteTab] initial load failed', e);
        setLoading(false);
      }
    });
    return () => ctrl.abort();
  }, []);

  // ── publish handler ────────────────────────────────────

  async function publishDraft(d: Draft) {
    setPublishing(d.id);
    setPublishError(null);
    try {
      const r = await apiFetch(`/api/note-drafts/${encodeURIComponent(d.id)}/publish`, {
        method: 'POST',
        body: JSON.stringify({ account: d.account }),
      });
      const data = await r.json() as { ok?: boolean; publishedUrl?: string; error?: string };
      if (!r.ok || !data.ok) {
        setPublishError(data.error ?? `HTTP ${r.status}`);
      } else {
        setPublishSuccess(prev => ({ ...prev, [d.id]: data.publishedUrl ?? '' }));
        setConfirmDraft(null);
        apiFetch('/api/note-drafts').then(res => res.json())
          .then(nd => {
            setDrafts(nd.drafts ?? []);
            setDraftStats(nd.stats ?? { total: 0, noCover: 0, published: 0, draft: 0 });
          })
          .catch(() => {});
      }
    } catch (e) {
      setPublishError((e as Error).message ?? '公開失敗');
    }
    setPublishing(null);
  }

  // ── derived data ───────────────────────────────────────

  const { data: likeData,     accounts: likeAccts }    = pivotByAccount(sns, 'likes');
  const { data: followerData, accounts: followerAccts } = pivotByAccount(sns, 'followers');
  const latestFollowers = latestByAccount(sns, 'followers');
  const latestLikes     = latestByAccount(sns, 'likes');

  const likePm = pm.filter(m => m.metric_key === 'likes' && m.snapshot_at === 'total');
  const topArticles = [...new Map(likePm.map(m => [m.post_id, m])).values()]
    .sort((a, b) => b.value - a.value).slice(0, 5);

  const viralPosts = pm.filter(m => m.metric_key === 'likes' && m.snapshot_at === '24h' && m.value >= 10);

  // category stats: join pm.post_id (note key) → draft title → classify
  const keyToTitle: Record<string, string> = {};
  drafts.forEach(d => {
    const key = extractNoteKey(d.publishedUrl);
    if (key) keyToTitle[key] = d.title;
  });

  const catAgg: Record<string, { likes: number[]; pv: number[] }> = {};
  pm.forEach(m => {
    const title = keyToTitle[m.post_id];
    if (!title) return;
    const cat = classifyNoteTitle(title);
    if (!catAgg[cat]) catAgg[cat] = { likes: [], pv: [] };
    if (m.metric_key === 'likes') catAgg[cat].likes.push(m.value);
    if (m.metric_key === 'views' || m.metric_key === 'page_view') catAgg[cat].pv.push(m.value);
  });

  const catData = Object.entries(catAgg)
    .map(([name, { likes, pv }]) => ({
      name,
      avg_likes: likes.length ? Math.round(likes.reduce((a, b) => a + b, 0) / likes.length) : 0,
      avg_pv:    pv.length    ? Math.round(pv.reduce((a, b) => a + b, 0) / pv.length)       : 0,
    }))
    .sort((a, b) => b.avg_likes - a.avg_likes);

  if (loading) return <Spinner />;

  return (
    <>
      <KpiGrid items={[
        [Object.values(latestFollowers).reduce((s, v) => s + v, 0) || '—', '合計フォロワー'],
        [Object.values(latestLikes).reduce((s, v) => s + v, 0) || '—', '合計スキ(最新)'],
        [draftStats.total || '—', '下書き総数'],
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

      {draftStats.noCover > 0 && (
        <div className="mb-3 p-3 rounded-lg border border-amber-800 bg-amber-950/30">
          <span className="text-amber-400 text-xs font-bold">⚠ カバー画像なし: {draftStats.noCover}件</span>
          <span className="text-amber-300 text-xs ml-2">note記事のカバー画像を設定してください（CTR向上）</span>
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

      {/* ── Category performance ──────────────────────── */}
      <Section title="カテゴリ別パフォーマンス（avg スキ / avg PV）">
        {catData.length ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={catData} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                <XAxis type="number" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis type="category" dataKey="name" width={70} tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                <Bar dataKey="avg_likes" name="平均スキ" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} radius={[0, 2, 2, 0]} />
                <Bar dataKey="avg_pv"    name="平均PV"  fill="#22c55e40" stroke="#22c55e" strokeWidth={1} radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-1 text-[10px] text-neutral-600">
              ※ note_key → 下書きタイトルで簡易分類。PV は post_metrics.views 収集後に表示。
            </p>
          </>
        ) : (
          <p className="text-xs py-6 text-center text-neutral-500">
            公開済み記事の post_metrics 収集後に表示
          </p>
        )}
      </Section>

      <Section title="上位記事 Top5（スキ順）">
        {topArticles.length ? (
          <table className="w-full border-collapse">
            <thead><tr>
              <TH>post_id</TH><TH>アカウント</TH><TH>スキ数</TH><TH>記録日</TH>
            </tr></thead>
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

      {/* ── Drafts table with publish button ─────────── */}
      <Section title={`下書き一覧（${draftStats.total}件）`}>
        <div className="flex gap-4 mb-2 text-xs">
          <span className="text-green-400">公開済: {draftStats.published}</span>
          <span className="text-neutral-400">下書き: {draftStats.draft}</span>
          {draftStats.noCover > 0 && (
            <span className="text-red-400">カバーなし: {draftStats.noCover}</span>
          )}
        </div>
        {publishError && (
          <div className="mb-2 p-2 text-xs text-red-400 bg-red-950/30 rounded border border-red-800">
            公開エラー: {publishError}
          </div>
        )}
        {drafts.length ? (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>タイトル</TH><TH>アカウント</TH><TH>作成日</TH><TH>カバー</TH><TH>ステータス</TH><TH>操作</TH>
              </tr></thead>
              <tbody>{drafts.map(d => {
                const href = safeUrl(publishSuccess[d.id] ?? d.publishedUrl);
                const isPublished = d.status === 'published' || !!publishSuccess[d.id];
                return (
                  <tr key={d.id} className="hover:bg-neutral-800/30">
                    <TD className="max-w-xs">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                          className="text-violet-400 hover:underline truncate block max-w-[220px]">
                          {d.title.slice(0, 40)}
                        </a>
                      ) : (
                        <span className="truncate block max-w-[220px]">{d.title.slice(0, 40)}</span>
                      )}
                    </TD>
                    <TD>{d.account}</TD>
                    <TD>{fmtTs(d.createdAt)}</TD>
                    <TD>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        d.hasCoverImage
                          ? 'bg-green-950 text-green-400 border-green-800'
                          : 'bg-red-950 text-red-400 border-red-800'
                      }`}>{d.hasCoverImage ? '✓ あり' : '✗ なし'}</span>
                    </TD>
                    <TD>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        isPublished
                          ? 'bg-green-950 text-green-400 border-green-800'
                          : 'bg-neutral-800 text-neutral-400 border-neutral-600'
                      }`}>{isPublished ? 'published' : d.status}</span>
                    </TD>
                    <TD>
                      {isPublished ? (
                        href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-violet-400 hover:underline">
                            → 表示
                          </a>
                        ) : (
                          <span className="text-[10px] text-green-400">公開済</span>
                        )
                      ) : (
                        <button
                          onClick={() => setConfirmDraft(d)}
                          disabled={publishing === d.id}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold border border-green-700 bg-green-950 text-green-300 hover:bg-green-900 disabled:opacity-50"
                        >
                          {publishing === d.id ? '...' : '▶ 公開'}
                        </button>
                      )}
                    </TD>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>

      {/* ── Curator history ───────────────────────────── */}
      <Section title={`キュレーター掲載履歴（${curatorHistory.length}件）`}>
        {curatorHistory.length ? (
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>日付</TH><TH>キュレーター</TH><TH>記事タイトル</TH><TH>リンク</TH>
              </tr></thead>
              <tbody>{curatorHistory.map((h, i) => (
                <tr key={i} className="hover:bg-neutral-800/30">
                  <TD className="whitespace-nowrap font-mono text-[11px]">{h.date}</TD>
                  <TD className="font-semibold text-violet-300">{h.curator}</TD>
                  <TD className="max-w-xs">
                    <span className="truncate block max-w-[280px]">{h.articleTitle}</span>
                  </TD>
                  <TD>
                    {safeUrl(h.url) && (
                      <a href={safeUrl(h.url)!} target="_blank" rel="noopener noreferrer"
                        className="text-violet-400 hover:underline text-xs">→ 記事</a>
                    )}
                  </TD>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState msg="掲載履歴はまだありません" />}
      </Section>

      {/* ── Sales tracking ────────────────────────────── */}
      <Section title="有料記事売上トラッキング">
        <NoteSalesSection />
      </Section>

      {/* ── Referrer breakdown ────────────────────────── */}
      <Section title="記事別流入元">
        <NoteReferrerSection pm={pm} />
      </Section>

      {/* ── P2: Monthly revenue trend ─────────────────── */}
      <Section title="月次収益トレンド（有料記事）">
        {monthlyRevenue.length ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyRevenue} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
              <XAxis dataKey="month" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
              <YAxis tick={{ ...CHART_STYLE, fill: '#6b7280' }} unit="¥" />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown) => [`¥${Number(v).toLocaleString()}`, '収益']} />
              <Bar dataKey="revenue" fill="#22c55e40" stroke="#22c55e" strokeWidth={1} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs py-6 text-center text-neutral-500">有料記事の売上発生後に自動表示（price &gt; 0 かつ revenue &gt; 0 のドラフトから集計）</p>
        )}
      </Section>

      {/* ── P2: Curator PV impact ─────────────────────── */}
      <Section title="編集部おすすめ PV影響（±7日平均）">
        {curatorImpact.length ? (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>日付</TH><TH>キュレーター</TH><TH>記事タイトル</TH>
                <TH>前7日PV</TH><TH>後7日PV</TH><TH>変化率</TH>
              </tr></thead>
              <tbody>{curatorImpact.map((h, i) => {
                const pct = h.pvGrowthPct;
                const pctCls = pct == null ? 'text-neutral-500'
                  : pct >= 0 ? 'text-green-400' : 'text-red-400';
                return (
                  <tr key={i} className="hover:bg-neutral-800/30">
                    <TD className="font-mono text-[11px]">{h.date}</TD>
                    <TD className="text-violet-300 font-semibold">{h.curator}</TD>
                    <TD className="max-w-[180px] truncate text-[11px]">{h.articleTitle}</TD>
                    <TD className="font-mono">{h.pvBefore != null ? h.pvBefore.toLocaleString() : '—'}</TD>
                    <TD className="font-mono">{h.pvAfter  != null ? h.pvAfter.toLocaleString()  : '—'}</TD>
                    <TD className={`font-bold ${pctCls}`}>
                      {pct != null ? `${pct >= 0 ? '+' : ''}${pct}%` : '—'}
                    </TD>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs py-6 text-center text-neutral-500">curator-history.json に記録後に表示</p>
        )}
      </Section>

      {/* ── Publish confirm modal ─────────────────────── */}
      {confirmDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => { if (publishing !== confirmDraft.id) setConfirmDraft(null); }}
        >
          <div
            className="flex flex-col gap-4 rounded-lg border p-6"
            style={{ background: '#111', borderColor: '#333', minWidth: 340, maxWidth: 480 }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-neutral-100">この記事を公開しますか？</p>
            <div className="text-xs text-neutral-400 space-y-1">
              <p className="truncate">{confirmDraft.title}</p>
              <p>アカウント: <span className="text-neutral-200">{confirmDraft.account}</span></p>
              <p className="text-amber-400">
                ⚠ Playwright による自動公開（1〜3分かかる場合があります）
              </p>
            </div>
            {publishError && publishing !== confirmDraft.id && (
              <p className="text-xs text-red-400">{publishError}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setConfirmDraft(null); setPublishError(null); }}
                disabled={publishing === confirmDraft.id}
                className="px-3 py-1.5 rounded text-xs border border-neutral-600 text-neutral-400 hover:text-neutral-200 disabled:opacity-40"
              >
                キャンセル
              </button>
              <button
                onClick={() => publishDraft(confirmDraft)}
                disabled={publishing === confirmDraft.id}
                className="px-4 py-1.5 rounded text-xs font-semibold border border-green-700 bg-green-950 text-green-300 hover:bg-green-900 disabled:opacity-50"
              >
                {publishing === confirmDraft.id ? '公開中...' : '公開する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
