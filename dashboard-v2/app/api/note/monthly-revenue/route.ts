import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  const DRAFTS_DIR = join(ROOT, 'note', 'drafts');

  try {
    const entries = await readdir(DRAFTS_DIR, { withFileTypes: true });
    const monthMap: Record<string, number> = {};

    await Promise.all(
      entries
        .filter(e => e.isFile() && e.name.endsWith('.json'))
        .map(async e => {
          const tsStr = e.name.split('-')[0];
          const ts    = Number(tsStr);
          if (!Number.isFinite(ts) || ts <= 0) return;

          try {
            const raw = await readFile(join(DRAFTS_DIR, e.name), 'utf-8');
            const d   = JSON.parse(raw) as Record<string, unknown>;
            const price = typeof d.price === 'number' ? d.price : 0;
            if (price <= 0) return;
            const salesCount = typeof d.sales_count === 'number' ? d.sales_count : 0;
            const revenue    = typeof d.revenue     === 'number' ? d.revenue
                              : price * salesCount;
            if (revenue <= 0) return;

            const month = new Date(ts).toISOString().slice(0, 7); // YYYY-MM
            monthMap[month] = (monthMap[month] ?? 0) + revenue;
          } catch {
            // skip unreadable files
          }
        }),
    );

    const series = Object.entries(monthMap)
      .map(([month, revenue]) => ({ month, revenue: Math.round(revenue) }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({ series });
  } catch (err) {
    console.error('[note/monthly-revenue]', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
