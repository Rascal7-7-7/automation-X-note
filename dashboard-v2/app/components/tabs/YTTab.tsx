'use client';

import { Fragment, useState, useEffect } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Section, KpiGrid, EmptyState, Spinner, TH, TD,
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

interface VideoStat {
  post_id: string;
  account: string | null;
  title: string;
  thumbnail_url: string | null;
  ctr: number | null;
  impressions: number | null;
  clicks: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration_sec: number | null;
  video_type: 'ショート' | '長尺';
}

interface HeatmapCell {
  day: number;
  hour: number;
  value: number;
}

const YT_DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const YT_DAY_ORDER  = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun

function pipelineCls(s: string) {
  if (s === 'done' || s === 'success') return 'bg-green-950 text-green-400 border-green-800';
  if (s === 'failed' || s === 'error') return 'bg-red-950 text-red-400 border-red-800';
  if (s === 'rendering' || s === 'retrying') return 'bg-blue-950 text-blue-400 border-blue-800';
  if (s === 'pending') return 'bg-amber-950 text-amber-400 border-amber-800';
  return 'bg-neutral-800 text-neutral-400 border-neutral-600';
}

// YouTube video IDs are exactly 11 chars [A-Za-z0-9_-]
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function resolveThumbnail(post_id: string, stored: string | null): string | null {
  if (stored) return stored;
  if (YT_ID_RE.test(post_id)) return `https://i.ytimg.com/vi/${post_id}/hqdefault.jpg`;
  return null;
}

function CtrBadge({ ctr }: { ctr: number | null }) {
  if (ctr === null) return <span className="text-neutral-500">—</span>;
  const cls = ctr >= 5
    ? 'bg-green-900 text-green-400 border-green-700'
    : ctr >= 3
      ? 'bg-amber-900 text-amber-400 border-amber-700'
      : 'bg-red-900 text-red-400 border-red-700';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] border font-mono ${cls}`}>
      {ctr.toFixed(1)}%
    </span>
  );
}

function LikeRateBadge({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-neutral-500">—</span>;
  const cls = rate >= 5
    ? 'bg-green-900 text-green-400 border-green-700'
    : rate >= 2
      ? 'bg-amber-900 text-amber-400 border-amber-700'
      : 'bg-red-900 text-red-400 border-red-700';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] border font-mono ${cls}`}>
      {rate.toFixed(1)}%
    </span>
  );
}

function avgOf(nums: (number | null)[]): number {
  const valid = nums.filter((x): x is number => x !== null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function YTHeatmap() {
  const [cells, setCells]   = useState<HeatmapCell[]>([]);
  const [maxVal, setMaxVal] = useState(1);
  const [hmLoad, setHmLoad] = useState(true);

  useEffect(() => {
    apiFetch('/api/post-metrics/heatmap?platform=youtube')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.cells) { setCells(d.cells); setMaxVal(d.max ?? 1); }
        setHmLoad(false);
      })
      .catch(() => setHmLoad(false));
  }, []);

  if (hmLoad) return <Spinner />;
  if (!cells.length) return <EmptyState />;

  const validCells = cells.filter(c => c.day >= 0 && c.day <= 6 && c.hour >= 0 && c.hour <= 23);
  const cellMap = new Map(validCells.map(c => [`${c.day}-${c.hour}`, c.value]));
  const top3Set = new Set(
    [...validCells].sort((a, b) => b.value - a.value).slice(0, 3).map(c => `${c.day}-${c.hour}`),
  );

  const hourAvgs = Array.from({ length: 24 }, (_, h) => {
    const vals = YT_DAY_ORDER.map(d => cellMap.get(`${d}-${h}`)).filter((v): v is number => v !== undefined);
    return { hour: h, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0 };
  });
  const bestHour = [...hourAvgs].sort((a, b) => b.avg - a.avg)[0]?.hour ?? 18;

  return (
    <>
      <div className="overflow-x-auto">
        <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(24, 1fr)', gap: 2, minWidth: 600 }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[9px] text-neutral-500 pb-0.5">{h}</div>
          ))}
          {YT_DAY_ORDER.map(dayIdx => (
            <Fragment key={dayIdx}>
              <div className="text-[10px] text-neutral-400 pr-1.5 flex items-center">
                {YT_DAY_LABELS[dayIdx]}
              </div>
              {Array.from({ length: 24 }, (_, h) => {
                const v         = cellMap.get(`${dayIdx}-${h}`) ?? 0;
                const intensity = maxVal > 0 ? v / maxVal : 0;
                const isTop     = top3Set.has(`${dayIdx}-${h}`);
                return (
                  <div
                    key={h}
                    title={`${YT_DAY_LABELS[dayIdx]} ${h}:00 — ${v.toLocaleString()}`}
                    style={{ background: v === 0 ? 'rgba(255,255,255,0.04)' : `rgba(249,115,22,${Math.max(0.15, intensity)})` }}
                    className={`h-4 rounded-sm ${isTop ? 'ring-1 ring-orange-400' : ''}`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-neutral-500 mt-2">
        現在: 毎日18:00固定 → 推奨:{' '}
        <span className="text-orange-400 font-semibold">{bestHour}時</span>（直近90日データより）
      </p>
    </>
  );
}

function VideoEngagementTable({ videos }: { videos: VideoStat[] }) {
  const rows = videos
    .map(v => {
      const likeRate = v.views && v.views > 0 && v.likes !== null
        ? (v.likes / v.views) * 100
        : null;
      return { ...v, likeRate };
    })
    .filter((v): v is typeof v & { likeRate: number } => v.likeRate !== null)
    .sort((a, b) => b.likeRate - a.likeRate)
    .slice(0, 15);

  if (!rows.length) return <EmptyState />;

  return (
    <div style={{ maxHeight: 360, overflowY: 'auto' }}>
      <table className="w-full border-collapse">
        <thead><tr>
          <TH>タイトル</TH>
          <TH>種別</TH>
          <TH>再生数</TH>
          <TH>高評価率</TH>
          <TH>コメント</TH>
          <TH>横展開</TH>
        </tr></thead>
        <tbody>
          {rows.map(v => {
            const crossPromo = (v.likeRate ?? 0) >= 3 && (v.comments ?? 0) >= 5;
            return (
              <tr key={v.post_id} className="hover:bg-neutral-800/30">
                <TD className="max-w-[180px] truncate text-xs">{v.title}</TD>
                <TD className="text-xs">{v.video_type}</TD>
                <TD className="text-xs">{v.views?.toLocaleString() ?? '—'}</TD>
                <TD><LikeRateBadge rate={v.likeRate} /></TD>
                <TD className="text-xs">{v.comments?.toLocaleString() ?? '—'}</TD>
                <TD>
                  {crossPromo
                    ? <span className="text-yellow-400 font-bold">★</span>
                    : <span className="text-neutral-600">—</span>}
                </TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function YTTab() {
  const [sns, setSns]             = useState<SnsMetric[]>([]);
  const [pm, setPm]               = useState<PostMetric[]>([]);
  const [pipeline, setPipeline]   = useState<PipelineData>({ pipeline: [], byStatus: {} });
  const [videos, setVideos]       = useState<VideoStat[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();

    const safeFetch = (url: string) =>
      apiFetch(url, { signal: ctrl.signal }).then(r => {
        if (!r.ok) throw new Error(`${url} ${r.status}`);
        return r.json();
      });

    Promise.allSettled([
      safeFetch('/api/sns-metrics?platform=youtube&days=30'),
      safeFetch('/api/post-metrics?platform=youtube&limit=300'),
      safeFetch('/api/yt-pipeline'),
      safeFetch('/api/yt/video-stats'),
    ]).then(([s, p, pl, v]) => {
      if (ctrl.signal.aborted) return;
      if ([s, p, pl, v].every(r => r.status === 'rejected')) {
        setError('データの読み込みに失敗しました');
        setLoading(false);
        return;
      }
      if (s.status  === 'fulfilled') setSns(s.value.metrics ?? []);
      if (p.status  === 'fulfilled') setPm(p.value.metrics ?? []);
      if (pl.status === 'fulfilled') setPipeline(pl.value);
      if (v.status  === 'fulfilled') setVideos(v.value.videos ?? []);
      else console.error('[YTTab/video-stats]', v.status === 'rejected' ? v.reason : '');
      setLoading(false);
    });
    return () => ctrl.abort();
  }, [retryCount]);

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

  // CTR ranking — sorted desc, top 10
  const ctrRanking = videos
    .filter(v => v.ctr !== null)
    .slice()
    .sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0))
    .slice(0, 10);

  // Short vs Long comparison
  const VIDEO_TYPES = ['ショート', '長尺'] as const;
  const typeStats = VIDEO_TYPES.map(type => {
    const vids = videos.filter(v => v.video_type === type);
    return {
      type,
      count:         vids.length,
      avg_views:     avgOf(vids.map(v => v.views)),
      avg_ctr:       avgOf(vids.map(v => v.ctr)),
      avg_like_rate: avgOf(vids.map(v =>
        v.views && v.views > 0 && v.likes !== null ? (v.likes / v.views) * 100 : null,
      )),
      avg_comments:  avgOf(vids.map(v => v.comments)),
    };
  });
  const typeCompBarData = typeStats.map(t => ({
    name:     t.type,
    平均視聴回数: Math.round(t.avg_views),
    平均CTR:   parseFloat(t.avg_ctr.toFixed(2)),
  }));

  if (error) return (
    <div className="flex flex-col items-center py-8 gap-3">
      <p className="text-xs text-red-400">{error}</p>
      <button
        onClick={() => setRetryCount(c => c + 1)}
        className="px-3 py-1.5 text-xs rounded border border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
      >
        再試行
      </button>
    </div>
  );
  if (loading) return <Spinner />;

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

      <Section title="サムネイル別CTRランキング TOP10">
        {ctrRanking.length ? (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>#</TH>
                <TH>サムネイル</TH>
                <TH>タイトル</TH>
                <TH>CTR</TH>
                <TH>インプレッション</TH>
                <TH>クリック数</TH>
              </tr></thead>
              <tbody>
                {ctrRanking.map((v, i) => {
                  const thumb = resolveThumbnail(v.post_id, v.thumbnail_url);
                  return (
                    <tr key={v.post_id} className="hover:bg-neutral-800/30">
                      <TD className="text-neutral-500 w-6">{i + 1}</TD>
                      <TD className="w-12">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumb}
                            alt=""
                            width={40}
                            height={40}
                            className="rounded object-cover"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-neutral-700" />
                        )}
                      </TD>
                      <TD className="max-w-[200px] truncate text-xs">{v.title}</TD>
                      <TD><CtrBadge ctr={v.ctr} /></TD>
                      <TD className="text-xs">{v.impressions?.toLocaleString() ?? '—'}</TD>
                      <TD className="text-xs">{v.clicks?.toLocaleString() ?? '—'}</TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>

      <Section title="ショート vs 長尺 パフォーマンス比較">
        {videos.length ? (
          <>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {typeStats.map(t => (
                <div key={t.type} className="rounded-lg border border-neutral-700 bg-neutral-800/30 p-4">
                  <div className="text-sm font-semibold text-neutral-200 mb-3">
                    {t.type === 'ショート' ? '⚡ ショート' : '🎬 長尺'}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-neutral-500">本数</div>
                      <div className="text-neutral-100 font-medium">{t.count}</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">平均視聴回数</div>
                      <div className="text-neutral-100 font-medium">{Math.round(t.avg_views).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">平均CTR</div>
                      <div className="text-blue-400 font-bold">{t.avg_ctr.toFixed(2)}%</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">平均高評価率</div>
                      <div className="text-green-400 font-medium">{t.avg_like_rate.toFixed(2)}%</div>
                    </div>
                    <div>
                      <div className="text-neutral-500">平均コメント数</div>
                      <div className="text-neutral-100 font-medium">{t.avg_comments.toFixed(1)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={typeCompBarData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                <XAxis dataKey="name" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis yAxisId="left" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ ...CHART_STYLE, fill: '#6b7280' }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                <Bar yAxisId="left" dataKey="平均視聴回数" fill="#7c6ff740" stroke="#7c6ff7" strokeWidth={1} />
                <Bar yAxisId="right" dataKey="平均CTR" fill="#22c55e40" stroke="#22c55e" strokeWidth={1} unit="%" />
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : <EmptyState />}
      </Section>

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

      <Section title="公開タイミング別再生数ヒートマップ（YouTube · 直近90日）">
        <YTHeatmap />
      </Section>

      <Section title="動画別コメント数・高評価率（★=横展開推奨）">
        <VideoEngagementTable videos={videos} />
      </Section>
    </>
  );
}
