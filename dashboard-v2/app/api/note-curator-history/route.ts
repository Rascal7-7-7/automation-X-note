import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';
import { kvGet } from '@/lib/kv';

interface CuratorEntry {
  date: string;
  curator: string;
  articleTitle: string;
  url: string;
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const kvData = await kvGet<CuratorEntry[] | { history: CuratorEntry[] }>('note:curator-history');
  if (kvData) {
    const history = Array.isArray(kvData) ? kvData : kvData.history ?? [];
    return NextResponse.json({ history });
  }

  const ROOT = process.env.AUTOMATION_ROOT;
  // AUTOMATION_ROOT 未設定はローカル専用機能 — 空配列で graceful degradation
  if (!ROOT) return NextResponse.json({ history: [] });

  try {
    const raw = await readFile(join(ROOT, 'note', 'curator-history.json'), 'utf-8');
    const history = JSON.parse(raw) as CuratorEntry[];
    return NextResponse.json({ history: Array.isArray(history) ? history : [] });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return NextResponse.json({ history: [] });
    return NextResponse.json({ error: 'failed to read curator history' }, { status: 500 });
  }
}
