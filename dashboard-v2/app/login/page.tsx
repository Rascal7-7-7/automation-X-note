'use client';

import { useState, FormEvent } from 'react';

export default function LoginPage() {
  const [secret, setSecret] = useState('');
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
        credentials: 'include',
      });
      if (r.ok) {
        window.location.href = '/';
      } else {
        const d = await r.json() as { error?: string };
        setError(d.error ?? 'ログイン失敗');
      }
    } catch {
      setError('サーバーに接続できません');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-mono"
      style={{ background: '#0d0d0d' }}>
      <div className="w-full max-w-sm p-8 rounded-xl"
        style={{ background: '#161616', border: '1px solid #262626' }}>
        <h1 className="text-sm font-bold mb-6" style={{ color: '#7c6ff7' }}>
          SNS AUTO v2
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            placeholder="ダッシュボードシークレット"
            autoFocus
            required
            className="w-full px-3 py-2 text-sm rounded bg-neutral-900 border text-neutral-200 placeholder-neutral-600 outline-none focus:border-violet-600"
            style={{ borderColor: '#262626' }}
          />
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 text-sm font-semibold rounded disabled:opacity-50"
            style={{ background: '#1a1040', border: '1px solid #7c6ff750', color: '#a78bfa' }}
          >
            {loading ? '...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}
