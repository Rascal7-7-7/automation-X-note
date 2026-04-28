'use client';

import { useState, useEffect, useCallback } from 'react';
import { Section, KpiGrid, EmptyState, TH, TD, fmtTs } from '../ui';

interface Workflow {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
  createdAt: string;
}

interface Execution {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: 'success' | 'error' | 'running' | 'waiting';
  startedAt: string;
  stoppedAt?: string;
}

interface SchedulerData {
  workflows: Workflow[];
  executions: Execution[];
  n8nReachable: boolean;
}

function statusCls(s: string) {
  if (s === 'success') return 'bg-green-950 text-green-400 border-green-800';
  if (s === 'error')   return 'bg-red-950 text-red-400 border-red-800';
  if (s === 'running') return 'bg-blue-950 text-blue-400 border-blue-800';
  return 'bg-neutral-800 text-neutral-400 border-neutral-600';
}

export default function SchedulerTab() {
  const [data, setData]       = useState<SchedulerData>({ workflows: [], executions: [], n8nReachable: false });
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling]   = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  // manual refresh (used after toggle/trigger — no abort needed for user actions)
  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/scheduler');
      const d = await r.json() as SchedulerData;
      setData(d);
    } catch (e) {
      setError('n8n接続エラー: ' + (e instanceof Error ? e.message : String(e)));
    }
    setLoading(false);
  }, []);

  // initial fetch with cleanup
  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/scheduler', { signal: ctrl.signal })
      .then(r => r.json() as Promise<SchedulerData>)
      .then(d => {
        if (ctrl.signal.aborted) return;
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        if (e.name !== 'AbortError') {
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
      const r = await fetch(`/api/scheduler/${wf.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !wf.active }),
      });
      if (!r.ok) setError('ワークフロー切替失敗');
      else await load();
    } catch (e) {
      setError('n8n接続エラー: ' + (e instanceof Error ? e.message : String(e)));
    }
    setToggling(null);
  }

  async function trigger(wf: Workflow) {
    setTriggering(wf.id);
    setError(null);
    try {
      const r = await fetch(`/api/scheduler/${wf.id}/trigger`, { method: 'POST' });
      if (!r.ok) setError('ワークフロー実行失敗');
    } catch (e) {
      setError('n8n接続エラー: ' + (e instanceof Error ? e.message : String(e)));
    }
    setTriggering(null);
    setTimeout(load, 1500);
  }

  const active  = data.workflows.filter(w => w.active).length;
  const failed  = data.executions.filter(e => e.status === 'error').length;
  const running = data.executions.filter(e => e.status === 'running').length;

  if (loading) return <EmptyState msg="読み込み中..." />;

  return (
    <>
      {error && (
        <div className="mb-2 p-2 text-xs text-red-400 bg-red-950/30 rounded border border-red-800">
          {error}
        </div>
      )}

      {!data.n8nReachable && (
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

      <Section title="ワークフロー一覧">
        {data.workflows.length ? (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>名前</TH>
                <TH>状態</TH>
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

      <Section title="直近実行履歴（30件）">
        {data.executions.length ? (
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table className="w-full border-collapse">
              <thead><tr>
                <TH>ワークフロー</TH>
                <TH>ステータス</TH>
                <TH>開始</TH>
                <TH>終了</TH>
              </tr></thead>
              <tbody>
                {data.executions.map(e => (
                  <tr key={e.id} className="hover:bg-neutral-800/30">
                    <TD>{e.workflowName ?? e.workflowId}</TD>
                    <TD>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] border ${statusCls(e.status)}`}>
                        {e.status}
                      </span>
                    </TD>
                    <TD>{fmtTs(e.startedAt)}</TD>
                    <TD>{e.stoppedAt ? fmtTs(e.stoppedAt) : '—'}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState />}
      </Section>
    </>
  );
}
