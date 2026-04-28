import { NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';

interface Draft {
  id: string;
  account: string;
  title: string;
  createdAt: string;
  hasCoverImage: boolean;
  publishedUrl: string | null;
  status: 'draft' | 'published';
}

async function readDraft(filePath: string, account: string): Promise<Draft | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as {
      title?: string;
      name?: string;
      publishedUrl?: string;
      published_url?: string;
      coverImageUrl?: string;
      cover_image?: string;
      status?: string;
      createdAt?: string;
      created_at?: string;
    };
    const s = await stat(filePath);
    const name = filePath.split('/').pop() ?? '';
    return {
      id: name.replace('.json', ''),
      account,
      title: data.title ?? data.name ?? name.replace(/^\d+-/, '').replace('.json', '').replace(/-/g, ' '),
      createdAt: data.createdAt ?? data.created_at ?? s.birthtime.toISOString(),
      hasCoverImage: !!(data.coverImageUrl ?? data.cover_image),
      publishedUrl: data.publishedUrl ?? data.published_url ?? null,
      status: data.status === 'published' || (data.publishedUrl ?? data.published_url) ? 'published' : 'draft',
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  const DRAFTS_DIR = join(ROOT, 'note', 'drafts');

  try {
    const entries = await readdir(DRAFTS_DIR, { withFileTypes: true });
    const drafts: Draft[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const acct = entry.name;
        try {
          const subFiles = await readdir(join(DRAFTS_DIR, acct));
          for (const f of subFiles.filter(f => f.endsWith('.json'))) {
            const d = await readDraft(join(DRAFTS_DIR, acct, f), acct);
            if (d) drafts.push(d);
          }
        } catch { /* skip */ }
      } else if (entry.name.endsWith('.json')) {
        const d = await readDraft(join(DRAFTS_DIR, entry.name), 'account1');
        if (d) drafts.push(d);
      }
    }

    drafts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const stats = {
      total: drafts.length,
      noCover: drafts.filter(d => !d.hasCoverImage).length,
      published: drafts.filter(d => d.status === 'published').length,
      draft: drafts.filter(d => d.status === 'draft').length,
    };

    return NextResponse.json({ drafts, stats });
  } catch {
    return NextResponse.json({ drafts: [], stats: { total: 0, noCover: 0, published: 0, draft: 0 } });
  }
}
