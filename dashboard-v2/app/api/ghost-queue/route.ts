import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { checkAuth } from '@/lib/auth';

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

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

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
          const r = JSON.parse(line) as Record<string, unknown>;
          const keywords: string[] = Array.isArray(r.keywords)
            ? (r.keywords as string[])
            : typeof r.sourcePlatform === 'string'
              ? [r.sourcePlatform]
              : [];
          return {
            id:        typeof r.id === 'string' ? r.id : String(i),
            theme:     (typeof r.theme === 'string' ? r.theme : typeof r.topic === 'string' ? r.topic : '') || '',
            keywords,
            status:    normalizeStatus(r.status),
            createdAt: (typeof r.createdAt === 'string' ? r.createdAt
                       : typeof r.queuedAt   === 'string' ? r.queuedAt
                       : typeof r.enqueuedAt === 'string' ? r.enqueuedAt
                       : new Date().toISOString()),
          };
        } catch {
          return null;
        }
      })
      .filter((x): x is GhostIdea => x !== null);

    const stats = {
      pending:   ideas.filter(i => i.status === 'pending').length,
      generated: ideas.filter(i => i.status === 'generated').length,
      posted:    ideas.filter(i => i.status === 'posted').length,
      total:     ideas.length,
    };

    return NextResponse.json({ ideas, stats });
  } catch {
    return NextResponse.json({ error: 'failed to read queue' }, { status: 503 });
  }
}
