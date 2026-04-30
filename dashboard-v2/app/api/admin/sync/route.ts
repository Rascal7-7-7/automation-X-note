import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';
import { kvSet } from '@/lib/kv';
import fs from 'fs';
import path from 'path';

function readJson(filePath: string): unknown {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

export async function POST(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) {
    return NextResponse.json({ error: 'AUTOMATION_ROOT not set — sync is local-only' }, { status: 503 });
  }

  const results: { key: string; ok: boolean; reason?: string }[] = [];

  async function upsert(key: string, data: unknown) {
    if (data == null) { results.push({ key, ok: false, reason: 'file missing or unreadable' }); return; }
    try { await kvSet(key, data); results.push({ key, ok: true }); }
    catch (e) { results.push({ key, ok: false, reason: String(e) }); }
  }

  // YouTube analytics
  const ytDir = path.join(ROOT, 'youtube', 'analytics');
  if (fs.existsSync(ytDir)) {
    const files = fs.readdirSync(ytDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const snapshots = files.flatMap(f => {
      const raw = readJson(path.join(ytDir, f)) as Record<string, unknown> | null;
      if (!raw) return [];
      const ch = (raw.channel ?? {}) as Record<string, unknown>;
      return [{ date: raw.date, views: Number(ch.views ?? 0), watchMinutes: Number(ch.estimatedMinutesWatched ?? 0), avgViewPct: Math.min(100, Number(ch.averageViewPercentage ?? 0)), subscribersGained: Number(ch.subscribersGained ?? 0), subscribersLost: Number(ch.subscribersLost ?? 0), likes: Number(ch.likes ?? 0), comments: Number(ch.comments ?? 0) }];
    });
    if (snapshots.length) await upsert('yt:analytics:snapshots', { snapshots, latest: snapshots.at(-1) ?? null });
    else results.push({ key: 'yt:analytics:snapshots', ok: false, reason: 'no snapshot files' });
  }

  // Single-file syncs
  await upsert('analytics:quality-feedback', readJson(path.join(ROOT, 'analytics', 'quality-feedback.json')));
  await upsert('note:curator-history', readJson(path.join(ROOT, 'note', 'curator-history.json')));
  await upsert('ghost:asp-campaigns', readJson(path.join(ROOT, 'ghost', 'asp-campaigns.json')));
  await upsert('instagram:asp-campaigns', readJson(path.join(ROOT, 'instagram', 'asp-campaigns.json')));
  await upsert('instagram:token-dates', readJson(path.join(ROOT, 'instagram', '.instagram-token-dates.json')));
  for (const [file, key] of [['note-summary.json', 'analytics:note-summary'], ['x-summary.json', 'analytics:x-summary'], ['prompt-hints.json', 'analytics:prompt-hints']] as const) {
    await upsert(key, readJson(path.join(ROOT, 'analytics', 'reports', file)));
  }

  // Ghost queue (jsonl)
  const ghostQueuePath = path.join(ROOT, 'ghost', 'queue', 'ideas.jsonl');
  if (fs.existsSync(ghostQueuePath)) {
    const ideas = fs.readFileSync(ghostQueuePath, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
    await upsert('ghost:queue', { ideas });
  } else results.push({ key: 'ghost:queue', ok: false, reason: 'file missing' });

  // Note drafts
  const noteDraftsDir = path.join(ROOT, 'note', 'drafts');
  if (fs.existsSync(noteDraftsDir)) {
    const drafts: unknown[] = [];
    for (const entry of fs.readdirSync(noteDraftsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const sub = path.join(noteDraftsDir, entry.name);
        for (const f of fs.readdirSync(sub).filter(f => f.endsWith('.json'))) {
          const d = readJson(path.join(sub, f));
          if (d) drafts.push({ _file: f, _account: entry.name, ...(d as object) });
        }
      } else if (entry.name.endsWith('.json')) {
        const d = readJson(path.join(noteDraftsDir, entry.name));
        if (d) drafts.push({ _file: entry.name, _account: 'account1', ...(d as object) });
      }
    }
    await upsert('note:drafts', { drafts });
  } else results.push({ key: 'note:drafts', ok: false, reason: 'directory missing' });

  const ok = results.filter(r => r.ok).length;
  const ng = results.filter(r => !r.ok).length;
  return NextResponse.json({ results, summary: { ok, ng, total: results.length }, syncedAt: new Date().toISOString() });
}
