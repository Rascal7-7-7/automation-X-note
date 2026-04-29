'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/apiFetch';

interface DryRunToggleProps {
  onToggle?: (dryRun: boolean) => void;
}

export default function DryRunToggle({ onToggle }: DryRunToggleProps) {
  const [dryRun, setDryRun]   = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings')
      .then(r => r.json())
      .then(d => setDryRun(d.dryRun ?? true))
      .catch(() => setDryRun(true));
  }, []);

  async function toggle() {
    if (loading || dryRun === null) return;
    setLoading(true);
    const next = !dryRun;
    const res = await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ dryRun: next }),
    }).then(r => r.json()).catch(() => ({ ok: false }));

    if (res.ok) {
      setDryRun(next);
      onToggle?.(next);
    }
    setLoading(false);
  }

  if (dryRun === null) {
    return (
      <div className="w-24 h-7 rounded-full animate-pulse" style={{ background: '#1f1f1f' }} />
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={dryRun ? 'DRY RUN: 実際には投稿しません。クリックでLIVE切替' : 'LIVE: 実際に投稿します。クリックでDRY RUN切替'}
      className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full font-bold select-none disabled:opacity-60 transition-all"
      style={dryRun
        ? { background: '#451a03', border: '1px solid #92400e', color: '#fbbf24' }
        : { background: '#052e16', border: '1px solid #166534', color: '#4ade80' }
      }
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={dryRun
          ? { background: '#f59e0b', boxShadow: '0 0 6px #f59e0b80' }
          : { background: '#22c55e', boxShadow: '0 0 6px #22c55e80' }
        }
      />
      {loading ? '...' : dryRun ? 'DRY RUN' : 'LIVE'}
    </button>
  );
}
