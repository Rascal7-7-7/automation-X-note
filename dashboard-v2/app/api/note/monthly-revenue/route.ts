import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';
import { kvGet } from '@/lib/kv';

type RawDraft = Record<string, unknown> & { _file?: string };

function aggregateMonthly(drafts: RawDraft[]) {
  const monthMap: Record<string, number> = {};
  for (const d of drafts) {
    const file = d._file ?? '';
    const tsStr = file.split('-')[0];
    const ts = Number(tsStr);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const price = typeof d.price === 'number' ? d.price : 0;
    if (price <= 0) continue;
    const salesCount = typeof d.sales_count === 'number' ? d.sales_count : 0;
    const revenue = typeof d.revenue === 'number' ? d.revenue : price * salesCount;
    if (revenue <= 0) continue;
    const month = new Date(ts).toISOString().slice(0, 7);
    monthMap[month] = (monthMap[month] ?? 0) + revenue;
  }
  return Object.entries(monthMap)
    .map(([month, revenue]) => ({ month, revenue: Math.round(revenue) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const kvData = await kvGet<{ drafts: RawDraft[] }>('note:drafts');
  if (kvData?.drafts) {
    return NextResponse.json({ series: aggregateMonthly(kvData.drafts) });
  }

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  const DRAFTS_DIR = join(ROOT, 'note', 'drafts');

  try {
    const entries = await readdir(DRAFTS_DIR, { withFileTypes: true });
    const flatDrafts: RawDraft[] = await Promise.all(
      entries
        .filter(e => e.isFile() && e.name.endsWith('.json'))
        .map(async e => {
          try {
            const raw = await readFile(join(DRAFTS_DIR, e.name), 'utf-8');
            return { ...JSON.parse(raw) as Record<string, unknown>, _file: e.name };
          } catch {
            return { _file: e.name };
          }
        }),
    );
    return NextResponse.json({ series: aggregateMonthly(flatDrafts) });
  } catch (err) {
    console.error('[note/monthly-revenue]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
