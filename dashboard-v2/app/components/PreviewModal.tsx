'use client';

import { useState, useEffect, useCallback } from 'react';

// ── types ─────────────────────────────────────────────────

export interface DraftMetadata {
  title?: string;
  buzzType?: string;
  type?: string;         // youtube: short/long/reddit-short
  hashtags?: string[];
  thread?: string[];     // X thread array
}

export interface Draft {
  id: number;
  platform: string;
  account: string;
  content: string | null;
  media_url: string | null;
  status: string;
  scheduled_at: string | null;
  metadata: DraftMetadata | null;
  created_at: string;
}

interface PreviewModalProps {
  platform?: string;
  onClose: () => void;
}

// ── platform-specific preview ─────────────────────────────

function XPreview({ content, metadata }: { content: string; metadata: DraftMetadata | null }) {
  const threads = metadata?.thread?.length
    ? metadata.thread
    : content.split(/\n---\n|\|\|\|/).filter(Boolean);
  const firstLen = threads[0]?.trim().length ?? 0;
  const countColor = firstLen > 140 ? 'text-red-400' : firstLen > 120 ? 'text-amber-400' : 'text-neutral-500';

  return (
    <div className="space-y-3">
      {threads.map((t, i) => (
        <div key={i} className="rounded-xl p-4" style={{ background: '#16202a', border: '1px solid #2f3336' }}>
          {i > 0 && <div className="text-[10px] text-blue-400 mb-2 font-mono">↪ スレッド {i + 1}</div>}
          <p className="text-[13px] text-neutral-100 whitespace-pre-wrap leading-relaxed">{t.trim()}</p>
        </div>
      ))}
      <div className={`text-right text-xs font-mono ${countColor}`}>{firstLen} / 140</div>
    </div>
  );
}

function InstaPreview({ content, mediaUrl }: { content: string; mediaUrl?: string | null }) {
  const lines    = content.split('\n');
  const caption  = lines.filter(l => !l.startsWith('#')).join('\n').trim();
  const tags     = lines.filter(l => l.startsWith('#')).join(' ');
  const tagCount = (content.match(/#\S+/g) ?? []).length;

  return (
    <div className="space-y-3">
      {mediaUrl ? (
        <div className="rounded-lg overflow-hidden" style={{ aspectRatio: '1/1', maxHeight: 260, background: '#1a1a1a' }}>
          <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="rounded-lg flex items-center justify-center"
          style={{ aspectRatio: '1/1', maxHeight: 180, background: '#1a1a1a', border: '2px dashed #333' }}>
          <span className="text-neutral-600 text-xs">画像未設定</span>
        </div>
      )}
      <div className="rounded-lg p-3 space-y-2" style={{ background: '#161616', border: '1px solid #262626' }}>
        <p className="text-xs text-neutral-200 whitespace-pre-wrap leading-relaxed">{caption}</p>
        {tags && <p className="text-xs leading-relaxed" style={{ color: '#1d9bf0' }}>{tags}</p>}
        <div className="text-[10px] text-neutral-600">ハッシュタグ: {tagCount} 個</div>
      </div>
    </div>
  );
}

function NotePreview({ content, title }: { content: string; title?: string }) {
  return (
    <div className="rounded-lg p-4 space-y-2" style={{ background: '#161616', border: '1px solid #262626' }}>
      {title && <h3 className="text-sm font-bold text-neutral-100 leading-snug">{title}</h3>}
      <div className="text-[10px] text-neutral-600 pb-2" style={{ borderBottom: '1px solid #262626' }}>
        {content.length.toLocaleString()} 文字
      </div>
      <p className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed">
        {content.slice(0, 500)}{content.length > 500 ? '…' : ''}
      </p>
    </div>
  );
}

function YTPreview({ content, title, type, mediaUrl }: {
  content: string; title?: string; type?: string; mediaUrl?: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        {type && (
          <span className="px-2 py-0.5 rounded text-[10px] border bg-red-950 text-red-400 border-red-800">
            {type.toUpperCase()}
          </span>
        )}
      </div>
      {mediaUrl && (
        <div className="rounded-lg overflow-hidden" style={{ background: '#1a1a1a', aspectRatio: '16/9', maxHeight: 200 }}>
          <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      {title && <h3 className="text-sm font-bold text-neutral-100 leading-snug">{title}</h3>}
      <div className="rounded-lg p-3" style={{ background: '#161616', border: '1px solid #262626' }}>
        <p className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed">
          {content.slice(0, 600)}{content.length > 600 ? '…' : ''}
        </p>
      </div>
    </div>
  );
}

function GhostPreview({ content, title }: { content: string; title?: string }) {
  return (
    <div className="rounded-lg p-4 space-y-2" style={{ background: '#161616', border: '1px solid #262626' }}>
      {title && <h3 className="text-sm font-bold text-neutral-100 leading-snug">{title}</h3>}
      <p className="text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed">
        {content.slice(0, 500)}{content.length > 500 ? '…' : ''}
      </p>
    </div>
  );
}

function PlatformPreview({ draft }: { draft: Draft }) {
  const content  = draft.content ?? '';
  const metadata = draft.metadata;
  switch (draft.platform) {
    case 'x':
      return <XPreview content={content} metadata={metadata} />;
    case 'instagram':
      return <InstaPreview content={content} mediaUrl={draft.media_url} />;
    case 'note':
      return <NotePreview content={content} title={metadata?.title} />;
    case 'youtube':
      return <YTPreview content={content} title={metadata?.title} type={metadata?.type} mediaUrl={draft.media_url} />;
    case 'ghost':
      return <GhostPreview content={content} title={metadata?.title} />;
    default:
      return (
        <div className="rounded-lg p-3" style={{ background: '#161616', border: '1px solid #262626' }}>
          <p className="text-xs text-neutral-300 whitespace-pre-wrap">{content}</p>
        </div>
      );
  }
}

// ── helpers ───────────────────────────────────────────────

const PLATFORM_LABEL: Record<string, string> = {
  x: '𝕏 X', note: '📝 note', instagram: '📸 Instagram',
  youtube: '▶ YouTube', ghost: '👻 Ghost',
};

function fmtShort(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-neutral-600 mb-0.5">{label}</div>
      {children}
    </div>
  );
}

// ── modal ─────────────────────────────────────────────────

export default function PreviewModal({ platform, onClose }: PreviewModalProps) {
  const [drafts, setDrafts]   = useState<Draft[]>([]);
  const [idx, setIdx]         = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState(false);
  const [toast, setToast]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const qs  = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    const res = await fetch(`/api/preview${qs}`).then(r => r.json()).catch(() => ({ drafts: [] }));
    setDrafts(res.drafts ?? []);
    setIdx(0);
    setLoading(false);
  }, [platform]);

  useEffect(() => { load(); }, [load]);

  async function act(action: 'approved' | 'rejected') {
    const draft = drafts[idx];
    if (!draft || acting) return;
    setActing(true);

    const res = await fetch(`/api/posts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: action }),
    }).then(r => r.json()).catch(() => ({ ok: false }));

    setActing(false);
    if (res.ok) {
      const msg = action === 'approved' ? '✓ 承認済み — schedulerが投稿します' : '✕ 却下済み';
      setToast(msg);
      setTimeout(() => setToast(''), 3000);
      const next = drafts.filter((_, i) => i !== idx);
      setDrafts(next);
      setIdx(Math.min(idx, Math.max(0, next.length - 1)));
    }
  }

  function skip() {
    if (idx < drafts.length - 1) setIdx(i => i + 1);
    else onClose();
  }

  const draft = drafts[idx];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-3xl rounded-xl flex flex-col"
        style={{ background: '#111111', border: '1px solid #2a2a2a', maxHeight: '90vh' }}
      >
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: '1px solid #262626' }}>
          <div className="flex items-center gap-3">
            <span className="font-bold text-sm text-neutral-200">承認キュー</span>
            {drafts.length > 0 && (
              <span className="text-[11px] font-mono text-neutral-500">{idx + 1} / {drafts.length}</span>
            )}
            {toast && (
              <span className={`text-[11px] font-semibold ${toast.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                {toast}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={load} className="text-xs text-neutral-500 hover:text-neutral-300">↻</button>
            <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 text-xl leading-none">×</button>
          </div>
        </div>

        {/* body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20 text-xs text-neutral-500">読み込み中...</div>
        ) : !draft ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-4">
            <p className="text-sm text-neutral-500">保留中の下書きなし</p>
            <button onClick={load} className="text-xs px-3 py-1.5 rounded text-neutral-400 hover:text-neutral-200"
              style={{ background: '#1f1f1f' }}>↻ 再読み込み</button>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* left: content preview */}
            <div className="flex-1 p-5 overflow-y-auto min-w-0">
              <PlatformPreview draft={draft} />
            </div>

            {/* right: meta panel */}
            <div className="w-48 shrink-0 p-4 space-y-4 overflow-y-auto"
              style={{ borderLeft: '1px solid #262626' }}>
              <MetaRow label="プラットフォーム">
                <span className="text-sm font-bold text-neutral-200">
                  {PLATFORM_LABEL[draft.platform] ?? draft.platform}
                </span>
              </MetaRow>
              <MetaRow label="アカウント">
                <span className="text-xs text-neutral-300 break-all">{draft.account}</span>
              </MetaRow>
              {draft.metadata?.buzzType && (
                <MetaRow label="buzzType">
                  <span className="text-xs" style={{ color: '#a78bfa' }}>{draft.metadata.buzzType}</span>
                </MetaRow>
              )}
              {draft.metadata?.type && (
                <MetaRow label="タイプ">
                  <span className="text-xs text-neutral-300">{draft.metadata.type}</span>
                </MetaRow>
              )}
              <MetaRow label="予定投稿">
                <span className="text-xs text-neutral-300">{fmtShort(draft.scheduled_at)}</span>
              </MetaRow>
              <MetaRow label="作成日時">
                <span className="text-xs text-neutral-500">{fmtShort(draft.created_at)}</span>
              </MetaRow>

              {drafts.length > 1 && (
                <div className="flex gap-1.5 pt-2">
                  <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                    className="flex-1 py-1 rounded text-xs disabled:opacity-30 text-neutral-300 hover:text-white"
                    style={{ background: '#1f1f1f' }}>←</button>
                  <button onClick={() => setIdx(i => Math.min(drafts.length - 1, i + 1))}
                    disabled={idx === drafts.length - 1}
                    className="flex-1 py-1 rounded text-xs disabled:opacity-30 text-neutral-300 hover:text-white"
                    style={{ background: '#1f1f1f' }}>→</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* footer actions */}
        {draft && (
          <div className="flex gap-2 px-5 py-4 shrink-0" style={{ borderTop: '1px solid #262626' }}>
            <button onClick={() => act('approved')} disabled={acting}
              className="flex-1 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: '#16a34a', color: '#fff' }}>
              {acting ? '処理中...' : '✓ 承認して投稿'}
            </button>
            <button onClick={() => act('rejected')} disabled={acting}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
              ✕ 却下
            </button>
            <button onClick={skip} disabled={acting}
              className="px-5 py-2.5 rounded-lg text-sm disabled:opacity-30"
              style={{ background: '#1f1f1f', color: '#6b7280' }}>
              後で
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
