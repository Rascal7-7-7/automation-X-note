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

function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : null;
  } catch { return null; }
}

export default function NoteTab() {
  const [sns, setSns]         = useState<SnsMetric[]>([]);
  const [pm, setPm]           = useState<PostMetric[]>([]);
  const [drafts, setDrafts]   = useState<Draft[]>([]);
  const [draftStats, setDraftStats] = useState<DraftStats>({ total: 0, noCover: 0, published: 0, draft: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetch('/api/sns-metrics?platform=note&days=30', { signal: ctrl.signal }).then(r => r.json()),
      fetch('/api/post-metrics?platform=note&limit=200', { signal: ctrl.signal }).then(r => r.json()),
      fetch('/api/note-drafts', { signal: ctrl.signal }).then(r => r.json()),
    ]).then(([s, p, nd]) => {
      if (ctrl.signal.aborted) return;
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setDrafts(nd.drafts ?? []);
      setDraftStats(nd.stats ?? { total: 0, noCover: 0, published: 0, draft: 0 });
      setLoading(false);
    }).catch(e => { if (e.name !== 'AbortError') setLoading(false); });
    return () => ctrl.abort();
  }, []);

  const { data: likeData,     accounts: likeAccts }    = pivotByAccount(sns, 'likes');
  const { data: followerData, accounts: followerAccts } = pivotByAccount(sns, 'followers');
  const latestFollowers = latestByAccount(sns, 'followers');
  const latestLikes     = latestByAccount(sns, 'likes');

  const likePm = pm.filter(m => m.metric_key === 'likes' && m.snapshot_at === 'total');
  const topArticles = [...new Map(likePm.map(m => [m.post_id, m])).values()]
    .sort((a, b) => b.value - a.value).slice(0, 5);

  const viralPosts = pm.filter(m => m.metric_key === 'likes' && m.snapshot_at === '24h' && m.value >= 10);

  if (loading) return <EmptyState msg="読み込み中..." />;

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

      <Section title={`下書き一覧（${draftStats.total}件）`}>
        <div className="flex gap-4 mb-2 text-xs">
          <span className="text-green-400">公開済: {draftStats.published}</span>
          <span className="text-neutral-400">下書き: {draftStats.draft}</span>
          {draftStats.noCover > 0 && (
            <span className="text-red-400">カバーなし: {draftStats.noCover}</span>
          )}
        </div>
        {drafts.length ? (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>タイトル</TH><TH>アカウント</TH><TH>作成日</TH><TH>カバー</TH><TH>ステータス</TH>
              </tr></thead>
              <tbody>{drafts.map(d => (
                <tr key={d.id} className="hover:bg-neutral-800/30">
                  <TD className="max-w-xs">
                    {(() => {
                      const href = safeUrl(d.publishedUrl);
                      return href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                          className="text-violet-400 hover:underline truncate block max-w-[220px]">
                          {d.title.slice(0, 40)}
                        </a>
                      ) : (
                        <span className="truncate block max-w-[220px]">{d.title.slice(0, 40)}</span>
                      );
                    })()}
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
                      d.status === 'published'
                        ? 'bg-green-950 text-green-400 border-green-800'
                        : 'bg-neutral-800 text-neutral-400 border-neutral-600'
                    }`}>{d.status}</span>
                  </TD>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>
    </>
  );
}
