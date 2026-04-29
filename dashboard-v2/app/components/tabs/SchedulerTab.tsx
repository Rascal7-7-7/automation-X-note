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

export default function SchedulerTab() {
  const [data, setData]           = useState<SchedulerData>({ workflows: [], executions: [], n8nReachable: false });
  const [loading, setLoading]     = useState(true);
  const [toggling, setToggling]   = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [details, setDetails]     = useState<Record<string, ExecDetail | null>>({});
  const [retrying, setRetrying]   = useState<string | null>(null);

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

      <KpiGrid items={[
        [data.workflows.length, 'ワークフロー総数'],
        [active, 'アクティブ', active ? '' : 'text-neutral-500'],
        [failed, '直近エラー', failed ? 'text-red-400' : ''],
        [running, '実行中', running ? 'text-blue-400' : ''],
      ]} />

      {/* ── Workflow list ──────────────────────────────────── */}
      <Section title="ワークフロー一覧">
        {data.workflows.length ? (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>名前</TH>
                <TH>状態</TH>
                <TH>次回実行</TH>
                <TH>更新日時</TH>
                <TH>操作</TH>
              </tr></thead>
              <tbody>
                {data.workflows.map(wf => (
                  <tr key={wf.id} className="hover:bg-neutral-800/30">
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
                ))}
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
