import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { checkAuth } from '@/lib/auth';
import { kvGet } from '@/lib/kv';

export interface GhostIdea {
  id: string;
  theme: string;
  keywords: string[];
  status: 'pending' | 'generated' | 'posted';
  createdAt: string;
}

function normalizeStatus(s: unknown): GhostIdea['status'] {
  if (s === 'generated' || s === 'posted') return s;
  return 'pending';
}

function normalizeIdea(r: Record<string, unknown>, fallbackId: string): GhostIdea {
  const keywords: string[] = Array.isArray(r.keywords)
    ? (r.keywords as string[])
    : typeof r.sourcePlatform === 'string'
      ? [r.sourcePlatform]
      : [];
  return {
    id:        typeof r.id === 'string' ? r.id : fallbackId,
    theme:     (typeof r.theme === 'string' ? r.theme : typeof r.topic === 'string' ? r.topic : '') || '',
    keywords,
    status:    normalizeStatus(r.status),
    createdAt: (typeof r.createdAt === 'string' ? r.createdAt
               : typeof r.queuedAt   === 'string' ? r.queuedAt
               : typeof r.enqueuedAt === 'string' ? r.enqueuedAt
               : new Date().toISOString()),
  };
}

function buildStats(ideas: GhostIdea[]) {
  return {
    pending:   ideas.filter(i => i.status === 'pending').length,
    generated: ideas.filter(i => i.status === 'generated').length,
    posted:    ideas.filter(i => i.status === 'posted').length,
    total:     ideas.length,
  };
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const kvData = await kvGet<{ ideas: Record<string, unknown>[] }>('ghost:queue');
  if (kvData?.ideas) {
    const ideas = kvData.ideas.map((r: Record<string, unknown>, i: number) => normalizeIdea(r, String(i)));
    return NextResponse.json({ ideas, stats: buildStats(ideas) });
  }

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  const safeBase = resolve(ROOT);
  const target   = resolve(join(ROOT, 'ghost', 'queue', 'ideas.jsonl'));
  if (!target.startsWith(safeBase + '/')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 500 });
  }

  try {
    const raw = await readFile(target, 'utf-8');
    const ideas: GhostIdea[] = raw
      .split('\n')
      .filter(l => l.trim())
      .map((line, i) => {
        try {
          return normalizeIdea(JSON.parse(line) as Record<string, unknown>, String(i));
        } catch {
          return null;
        }
      })
      .filter((x): x is GhostIdea => x !== null);

    return NextResponse.json({ ideas, stats: buildStats(ideas) });
  } catch {
    return NextResponse.json({ error: 'failed to read queue' }, { status: 503 });
  }
}
