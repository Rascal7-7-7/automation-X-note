'use client';

// ── types ─────────────────────────────────────────────────

export interface SnsMetric {
  id: number;
  platform: string;
  account: string;
  metric_key: string;
  value: number;
  recorded_at: string;
}

export interface PostMetric {
  id: number;
  platform: string;
  post_id: string;
  account: string | null;
  metric_key: string;
  value: number;
  snapshot_at: string;
  recorded_at: string;
}

// ── formatters ────────────────────────────────────────────

export function fmtTs(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtDate(iso: string) {
  return iso.slice(5, 10); // MM-DD
}

// ── pivot helpers ─────────────────────────────────────────

export function pivotByAccount(metrics: SnsMetric[], metricKey: string) {
  const byDate: Record<string, Record<string, number>> = {};
  const accounts = new Set<string>();
  metrics
    .filter(m => m.metric_key === metricKey)
    .forEach(m => {
      const date = fmtDate(m.recorded_at);
      byDate[date] = { ...(byDate[date] ?? {}), [m.account]: m.value };
      accounts.add(m.account);
    });
  const data = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }));
  return { data, accounts: [...accounts] };
}

export function latestByAccount(metrics: SnsMetric[], metricKey: string) {
  const latest: Record<string, number> = {};
  metrics
    .filter(m => m.metric_key === metricKey)
    .forEach(m => { latest[m.account] = m.value; });
  return latest;
}

// ── CHART_STYLE / COLORS ──────────────────────────────────

export const CHART_STYLE = { fontSize: 11 };
export const LINE_COLORS = ['#7c6ff7', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6'];
export const TOOLTIP_STYLE = {
  contentStyle: { background: '#1a1a1a', border: '1px solid #333', fontSize: 11 },
};

// ── primitive components ──────────────────────────────────

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg p-4 ${className}`} style={{ background: '#161616', border: '1px solid #262626' }}>
      {children}
    </div>
  );
}

export function Section({
  title, children, defaultOpen = true,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="mb-3">
      <summary
        className="cursor-pointer text-sm font-semibold mb-3 py-2 px-4 rounded-lg select-none list-none"
        style={{ background: '#161616', border: '1px solid #262626', color: '#a78bfa' }}
      >
        ▸ {title}
      </summary>
      <div className="px-1 pb-2">{children}</div>
    </details>
  );
}

export function KpiGrid({ items }: { items: Array<[string | number, string, string?]> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {items.map(([val, label, cls = '']) => (
        <Card key={label}>
          <div className={`text-2xl font-bold text-gray-100 ${cls}`}>{val}</div>
          <div className="text-[11px] text-neutral-500 mt-1">{label}</div>
        </Card>
      ))}
    </div>
  );
}

export function EmptyState({ msg = 'データなし' }: { msg?: string }) {
  return <p className="text-xs py-6 text-center text-neutral-500">{msg}</p>;
}

export function TH({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left py-1.5 px-2 text-neutral-500 font-medium border-b text-[11px]"
      style={{ borderColor: '#262626' }}>{children}</th>
  );
}

export function TD({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-1 px-2 text-neutral-300 text-xs ${className}`}>{children}</td>;
}

export function StatusBadge({ ok, label }: { ok: boolean | null; label: string }) {
  const cls = ok === null
    ? 'bg-neutral-800 text-neutral-400 border-neutral-600'
    : ok ? 'bg-green-950 text-green-400 border-green-800'
    : 'bg-red-950 text-red-400 border-red-800';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${cls}`}>
      {label}: {ok === null ? 'N/A' : ok ? 'UP' : 'DOWN'}
    </span>
  );
}
