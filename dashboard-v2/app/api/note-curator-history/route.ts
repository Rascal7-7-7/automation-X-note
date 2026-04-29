import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';

interface CuratorEntry {
  date: string;
  curator: string;
  articleTitle: string;
  url: string;
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  const filePath = join(ROOT, 'note', 'curator-history.json');

  try {
    const raw = await readFile(filePath, 'utf-8');
    const history = JSON.parse(raw) as CuratorEntry[];
    return NextResponse.json({ history: Array.isArray(history) ? history : [] });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ history: [] });
    }
    return NextResponse.json({ error: 'failed to read curator history' }, { status: 500 });
  }
}
