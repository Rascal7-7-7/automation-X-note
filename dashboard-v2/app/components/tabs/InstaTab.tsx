'use client';

import { useState, useEffect } from 'react';
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

interface TokenInfo {
  account: string;
  expiresAt: string | null;
  daysLeft: number | null;
  status: 'ok' | 'warn' | 'expired' | 'unknown';
}

export default function InstaTab() {
  const [sns, setSns]       = useState<SnsMetric[]>([]);
  const [pm, setPm]         = useState<PostMetric[]>([]);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetch('/api/sns-metrics?platform=instagram&days=30', { signal: ctrl.signal }).then(r => r.json()),
      fetch('/api/post-metrics?platform=instagram&limit=300', { signal: ctrl.signal }).then(r => r.json()),
      fetch('/api/insta-token', { signal: ctrl.signal }).then(r => r.json()),
    ]).then(([s, p, t]) => {
      if (ctrl.signal.aborted) return;
      setSns(s.metrics ?? []);
      setPm(p.metrics ?? []);
      setTokens(t.tokens ?? []);
      setLoading(false);
    }).catch(e => { if (e.name !== 'AbortError') setLoading(false); });
    return () => ctrl.abort();
  }, []);

  const { data: followerData, accounts } = pivotByAccount(sns, 'followers');
  const { data: reachData }              = pivotByAccount(sns, 'reach');
  const latestFollowers = latestByAccount(sns, 'followers');

  const savesMap  = Object.fromEntries(pm.filter(m => m.metric_key === 'saves').map(m => [m.post_id, m.value]));
  const reachMap  = Object.fromEntries(pm.filter(m => m.metric_key === 'reach').map(m => [m.post_id, m.value]));
  const saveRates = Object.keys(savesMap)
    .filter(id => reachMap[id] && reachMap[id] > 0)
    .map(id => ({
      post_id: id.slice(0, 16),
      saveRate: parseFloat(((savesMap[id] / reachMap[id]) * 100).toFixed(2)),
    }))
    .sort((a, b) => b.saveRate - a.saveRate)
    .slice(0, 10);

  const buzzScores  = sns.filter(m => m.metric_key === 'avgScore');
  const buzzBarData = buzzScores.map(m => ({ account: m.account, score: m.value }));

  const expiredOrWarn = tokens.filter(t => t.status === 'expired' || t.status === 'warn');

  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
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
        {tokens.length ? (
          <div className="grid grid-cols-3 gap-3">
            {tokens.map(t => (
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
    </>
  );
}
