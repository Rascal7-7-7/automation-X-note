'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { Section, KpiGrid, EmptyState, Spinner, TH, TD, fmtTs } from '../ui';
import { apiFetch } from '@/lib/apiFetch';

interface Workflow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
  createdAt: string;
  nextRun?: string | null;
}

interface Execution {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: 'success' | 'error' | 'running' | 'waiting';
  startedAt: string;
  stoppedAt?: string;
}

interface ExecDetail {
  data?: {
    resultData?: {
      error?: { message?: string; stack?: string };
    };
  };
}

interface SchedulerData {
  workflows: Workflow[];
  executions: Execution[];
  n8nReachable: boolean;
  n8nAuthError?: boolean;
}

function statusCls(s: string) {
  if (s === 'success') return 'bg-green-950 text-green-400 border-green-800';
  if (s === 'error')   return 'bg-red-950 text-red-400 border-red-800';
  if (s === 'running') return 'bg-blue-950 text-blue-400 border-blue-800';
  return 'bg-neutral-800 text-neutral-400 border-neutral-600';
}

function isErrorStatus(s: string) {
  return s === 'error' || s === 'failed';
}

function fmtDur(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return '< 1h前';
  if (h < 24) return `${h}h前`;
  return `${Math.floor(h / 24)}日前`;
}

export default function SchedulerTab() {
  const [data, setData]           = useState<SchedulerData>({ workflows: [], executions: [], n8nReachable: false });
  const [loading, setLoading]     = useState(true);
  const [toggling, setToggling]   = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [details, setDetails]     = useState<Record<string, ExecDetail | null>>({});
  const [retrying, setRetrying]   = useState<string | null>(null);
  const [bulkToggling, setBulkToggling] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await apiFetch('/api/scheduler');
      const d = await r.json() as SchedulerData;
      setData(d);
    } catch (e) {
      setError('n8n接続エラー: ' + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch('/api/scheduler', { signal: ctrl.signal })
      .then(r => r.json() as Promise<SchedulerData>)
      .then(d => {
        if (ctrl.signal.aborted) return;
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        const isAbort = e instanceof DOMException && e.name === 'AbortError';
        if (!isAbort) {
          setError('スケジューラーデータの読み込みに失敗しました');
          setLoading(false);
        }
      });
    return () => ctrl.abort();
  }, []);

  async function toggle(wf: Workflow) {
    setToggling(wf.id);
    setError(null);
    try {
      const r = await apiFetch(`/api/scheduler/${wf.id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ active: !wf.active }),
      });
      if (!r.ok) setError('ワークフロー切替失敗');
      else await load();
    } catch (e) {
      setError('n8n接続エラー: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setToggling(null);
    }
  }

  async function bulkToggle(active: boolean) {
    setBulkToggling(true); setError(null);
    try {
      await Promise.all(
        data.workflows
          .filter(wf => wf.active !== active)
          .map(wf => apiFetch(`/api/scheduler/${wf.id}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ active }),
          })),
      );
      await load();
    } catch (e) {
      setError('一括操作エラー: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBulkToggling(false);
    }
  }

  async function trigger(wf: Workflow) {
    setTriggering(wf.id);
    setError(null);
    try {
      const r = await apiFetch(`/api/scheduler/${wf.id}/trigger`, { method: 'POST' });
      if (!r.ok) setError('ワークフロー実行失敗');
      else setTimeout(load, 1500);
    } catch (e) {
      setError('n8n接続エラー: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTriggering(null);
    }
  }

  async function toggleExpand(ex: Execution) {
    const next = new Set(expanded);
    if (next.has(ex.id)) {
      next.delete(ex.id);
      setExpanded(next);
      return;
    }
    next.add(ex.id);
    setExpanded(next);

    if (details[ex.id] !== undefined) return;
    try {
      const r = await apiFetch(`/api/scheduler/${ex.id}/execution`);
      const d = await r.json() as { execution?: ExecDetail };
      setDetails(prev => ({ ...prev, [ex.id]: d.execution ?? null }));
    } catch {
      setDetails(prev => ({ ...prev, [ex.id]: null }));
    }
  }

  async function retryExecution(ex: Execution) {
    setRetrying(ex.id);
    setError(null);
    try {
      const r = await apiFetch(`/api/scheduler/${ex.workflowId}/trigger`, { method: 'POST' });
      if (!r.ok) setError('再実行失敗');
      else setTimeout(load, 1500);
    } catch (e) {
      setError('n8n接続エラー: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRetrying(null);
    }
  }

  const active  = data.workflows.filter(w => w.active).length;
  const failed  = data.executions.filter(e => e.status === 'error').length;
  const running = data.executions.filter(e => e.status === 'running').length;

  const successRateMap: Record<string, { total: number; success: number }> = {};
  data.executions.forEach(ex => {
    if (!successRateMap[ex.workflowId]) successRateMap[ex.workflowId] = { total: 0, success: 0 };
    const isTerminal = ex.status !== 'running' && ex.status !== 'waiting';
    if (!isTerminal) return; // exclude in-progress executions from rate calculation
    successRateMap[ex.workflowId].total++;
    if (!isErrorStatus(ex.status)) successRateMap[ex.workflowId].success++;
  });

  // consecutive failures per workflow (most-recent terminal executions)
  const consecutiveFailMap: Record<string, number> = {};
  const terminalByWf: Record<string, Execution[]> = {};
  data.executions.forEach(ex => {
    if (ex.status === 'running' || ex.status === 'waiting') return;
    if (!terminalByWf[ex.workflowId]) terminalByWf[ex.workflowId] = [];
    terminalByWf[ex.workflowId].push(ex);
  });
  Object.entries(terminalByWf).forEach(([wfId, execs]) => {
    const sorted = [...execs].sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    let count = 0;
    for (const ex of sorted) {
      if (isErrorStatus(ex.status)) count++;
      else break;
    }
    consecutiveFailMap[wfId] = count;
  });
  const hasConsecutiveFail = Object.values(consecutiveFailMap).some(n => n >= 3);

  // average execution duration per workflow (seconds)
  const avgDurMap: Record<string, number> = {};
  const durAccum: Record<string, { sum: number; count: number }> = {};
  data.executions.forEach(ex => {
    if (ex.status === 'running' || ex.status === 'waiting' || !ex.stoppedAt) return;
    const dur = new Date(ex.stoppedAt).getTime() - new Date(ex.startedAt).getTime();
    if (!Number.isFinite(dur) || dur < 0) return;
    if (!durAccum[ex.workflowId]) durAccum[ex.workflowId] = { sum: 0, count: 0 };
    durAccum[ex.workflowId].sum += dur;
    durAccum[ex.workflowId].count++;
  });
  Object.entries(durAccum).forEach(([wfId, { sum, count }]) => {
    avgDurMap[wfId] = count > 0 ? Math.round(sum / count / 1000) : 0;
  });

  // last success time per workflow
  const lastSuccessMap: Record<string, string> = {};
  data.executions
    .filter(ex => ex.status === 'success' && ex.startedAt)
    .forEach(ex => {
      const cur = lastSuccessMap[ex.workflowId];
      if (!cur || new Date(ex.startedAt) > new Date(cur)) {
        lastSuccessMap[ex.workflowId] = ex.startedAt;
      }
    });

  if (loading) return <Spinner />;

  return (
    <>
      {error && (
        <div className="mb-2 p-2 text-xs text-red-400 bg-red-950/30 rounded border border-red-800">
          {error}
        </div>
      )}

      {data.n8nAuthError && (
        <div className="mb-3 p-3 rounded-lg border border-red-800 bg-red-950/30">
          <span className="text-red-400 text-xs font-bold">🔑 n8n 認証エラー — N8N_API_KEY が無効または未設定です</span>
        </div>
      )}

      {!data.n8nReachable && !data.n8nAuthError && (
        <div className="mb-3 p-3 rounded-lg border border-amber-800 bg-amber-950/30">
          <span className="text-amber-400 text-xs font-bold">⚠ n8n 未到達 — localhost:5678 が起動しているか確認してください</span>
        </div>
      )}

      {hasConsecutiveFail && (
        <div className="mb-3 p-3 rounded-lg border border-red-700 bg-red-950/40">
          <span className="text-red-300 text-xs font-bold">🔴 連続失敗ワークフロー検出 — 3回以上連続でエラーが発生しています。下表の赤行を確認してください</span>
        </div>
      )}

      <KpiGrid items={[
        [data.workflows.length, 'ワークフロー総数'],
        [active, 'アクティブ', active ? '' : 'text-neutral-500'],
        [failed, '直近エラー', failed ? 'text-red-400' : ''],
        [running, '実行中', running ? 'text-blue-400' : ''],
      ]} />

      {/* ── Bulk controls ─────────────────────────────────── */}
      {data.n8nReachable && data.workflows.length > 0 && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => bulkToggle(true)}
            disabled={bulkToggling}
            className="px-3 py-1.5 text-xs rounded bg-green-800 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {bulkToggling ? '処理中...' : '▶ 全再開'}
          </button>
          <button
            onClick={() => bulkToggle(false)}
            disabled={bulkToggling}
            className="px-3 py-1.5 text-xs rounded bg-red-900 hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {bulkToggling ? '処理中...' : '⏹ 全停止'}
          </button>
        </div>
      )}

      {/* ── Workflow list ──────────────────────────────────── */}
      <Section title="ワークフロー一覧">
        {data.workflows.length ? (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>名前</TH>
                <TH>状態</TH>
                <TH>成功率</TH>
                <TH>平均実行時間</TH>
                <TH>最終成功</TH>
                <TH>次回実行</TH>
                <TH>更新日時</TH>
                <TH>操作</TH>
              </tr></thead>
              <tbody>
                {data.workflows.map(wf => {
                  const consecFail = consecutiveFailMap[wf.id] ?? 0;
                  const isZombie = consecFail >= 3;
                  return (
                  <tr key={wf.id} className={isZombie ? 'bg-red-950/30 hover:bg-red-950/50' : 'hover:bg-neutral-800/30'}>
                    <TD className="font-medium">{wf.name}</TD>
                    <TD>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] border ${
                        wf.active
                          ? 'bg-green-950 text-green-400 border-green-800'
                          : 'bg-neutral-800 text-neutral-500 border-neutral-600'
                      }`}>
                        {wf.active ? '● ON' : '○ OFF'}
                      </span>
                    </TD>
                    <TD className="font-mono text-[11px]">
                      {(() => {
                        const sr = successRateMap[wf.id];
                        if (!sr || sr.total === 0) return <span className="text-neutral-500">—</span>;
                        const pct = Math.round(sr.success / sr.total * 100);
                        const cls = pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
                        return <span className={cls}>{pct}%</span>;
                      })()}
                    </TD>
                    <TD className="font-mono text-[11px]">
                      {avgDurMap[wf.id] != null
                        ? <span className="text-neutral-300">{fmtDur(avgDurMap[wf.id])}</span>
                        : <span className="text-neutral-500">—</span>}
                    </TD>
                    <TD className="font-mono text-[11px]">
                      {lastSuccessMap[wf.id]
                        ? <span className={consecFail >= 3 ? 'text-red-400' : 'text-neutral-400'}>{fmtAgo(lastSuccessMap[wf.id])}</span>
                        : <span className="text-neutral-500">—</span>}
                    </TD>
                    <TD className="font-mono text-[11px]">
                      {wf.nextRun
                        ? new Date(wf.nextRun).toLocaleString('ja-JP', {
                            month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : '—'}
                    </TD>
                    <TD>{fmtTs(wf.updatedAt)}</TD>
                    <TD>
                      <div className="flex gap-2">
                        <button
                          onClick={() => trigger(wf)}
                          disabled={triggering === wf.id}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold border border-blue-800 bg-blue-950 text-blue-400 hover:bg-blue-900 disabled:opacity-50"
                        >
                          {triggering === wf.id ? '...' : '▶ 実行'}
                        </button>
                        <button
                          onClick={() => toggle(wf)}
                          disabled={toggling === wf.id}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border disabled:opacity-50 ${
                            wf.active
                              ? 'border-neutral-600 bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                              : 'border-green-800 bg-green-950 text-green-400 hover:bg-green-900'
                          }`}
                        >
                          {toggling === wf.id ? '...' : wf.active ? '停止' : '有効化'}
                        </button>
                      </div>
                    </TD>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState msg="ワークフローなし（n8n API KEY が必要な場合は N8N_API_KEY を設定）" />}
      </Section>

      {/* ── Execution history ──────────────────────────────── */}
      <Section title="直近実行履歴（30件）">
        {data.executions.length ? (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>ワークフロー</TH>
                <TH>ステータス</TH>
                <TH>開始</TH>
                <TH>終了</TH>
                <TH>操作</TH>
              </tr></thead>
              <tbody>
                {data.executions.map(ex => {
                  const isErr = isErrorStatus(ex.status);
                  const isOpen = expanded.has(ex.id);
                  const detail = details[ex.id];
                  const errMsg = detail?.data?.resultData?.error?.message ?? null;
                  const errStack = detail?.data?.resultData?.error?.stack ?? null;
                  const stackLines = errStack
                    ? errStack.split('\n').slice(0, 100).join('\n')
                    : null;

                  return (
                    <Fragment key={ex.id}>
                      <tr
                        onClick={isErr ? () => toggleExpand(ex) : undefined}
                        className={`${isErr ? 'cursor-pointer' : ''} ${
                          isOpen
                            ? 'bg-red-950/20'
                            : isErr
                              ? 'hover:bg-red-950/10'
                              : 'hover:bg-neutral-800/30'
                        }`}
                      >
                        <TD>{ex.workflowName ?? ex.workflowId}</TD>
                        <TD>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] border ${statusCls(ex.status)}`}>
                            {ex.status}
                          </span>
                        </TD>
                        <TD>{fmtTs(ex.startedAt)}</TD>
                        <TD>{ex.stoppedAt ? fmtTs(ex.stoppedAt) : '—'}</TD>
                        <TD>
                          {isErr && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-red-400 select-none">
                                {isOpen ? '▲ 閉じる' : '▼ 詳細'}
                              </span>
                              <button
                                onClick={e => { e.stopPropagation(); retryExecution(ex); }}
                                disabled={retrying === ex.id}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold border border-amber-700 bg-amber-950 text-amber-400 hover:bg-amber-900 disabled:opacity-50"
                              >
                                {retrying === ex.id ? '...' : '↩ 再実行'}
                              </button>
                            </div>
                          )}
                        </TD>
                      </tr>
                      {isOpen && (
                        <tr key={`${ex.id}-detail`} style={{ background: 'rgba(127,29,29,0.12)' }}>
                          <td colSpan={5} className="px-3 pb-3 pt-1">
                            {detail === undefined ? (
                              <span className="text-xs text-neutral-500">読み込み中...</span>
                            ) : detail === null ? (
                              <span className="text-xs text-red-400">詳細取得失敗</span>
                            ) : (
                              <div className="space-y-1">
                                {errMsg && (
                                  <p className="text-xs text-red-300 font-semibold">{errMsg}</p>
                                )}
                                {stackLines && (
                                  <pre
                                    className="text-[10px] text-neutral-400 overflow-x-auto"
                                    style={{
                                      maxHeight: 240,
                                      overflowY: 'auto',
                                      background: '#0a0a0a',
                                      padding: '6px 8px',
                                      borderRadius: 4,
                                      border: '1px solid #262626',
                                    }}
                                  >
                                    {stackLines}
                                  </pre>
                                )}
                                {!errMsg && !stackLines && (
                                  <span className="text-xs text-neutral-500">エラー詳細なし</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>
    </>
  );
}
