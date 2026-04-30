import { NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';

interface SalesDraft {
  title: string;
  price: number;
  sales_count: number;
  revenue: number;
  status: string;
  accountId: number;
  noteUrl: string | null;
}

async function readSalesDraft(filePath: string, defaultAccount: number): Promise<SalesDraft | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const d = JSON.parse(raw) as Record<string, unknown>;
    const price = typeof d.price === 'number' ? d.price : 0;
    if (price <= 0) return null;
    const sales_count = typeof d.sales_count === 'number' ? d.sales_count : 0;
    const revenue     = typeof d.revenue     === 'number' ? d.revenue     : price * sales_count;
    return {
      title:     typeof d.title     === 'string' ? d.title     : '(untitled)',
      price,
      sales_count,
      revenue,
      status:    typeof d.status    === 'string' ? d.status    : 'unknown',
      accountId: typeof d.accountId === 'number' ? d.accountId : defaultAccount,
      noteUrl:   typeof d.noteUrl   === 'string' ? d.noteUrl   : null,
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ articles: [], summary: { paid_count: 0, total_revenue: 0, avg_price: 0 } });

  const DRAFTS_DIR = join(ROOT, 'note', 'drafts');

  try {
    const entries = await readdir(DRAFTS_DIR, { withFileTypes: true });
    const articles: SalesDraft[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.includes('..')) continue;
        const acctNum = parseInt(entry.name.replace('account', '')) || 2;
        try {
          const subFiles = await readdir(join(DRAFTS_DIR, entry.name));
          for (const f of subFiles.filter(f => f.endsWith('.json') && !f.includes('..'))) {
            const d = await readSalesDraft(join(DRAFTS_DIR, entry.name, f), acctNum);
            if (d) articles.push(d);
          }
        } catch { /* skip inaccessible subdirs */ }
      } else if (entry.name.endsWith('.json') && !entry.name.includes('..')) {
        const d = await readSalesDraft(join(DRAFTS_DIR, entry.name), 1);
        if (d) articles.push(d);
      }
    }

    articles.sort((a, b) => b.revenue - a.revenue || b.price - a.price);

    const totalRevenue = articles.reduce((s, a) => s + a.revenue, 0);
    const avgPrice     = articles.length
      ? Math.round(articles.reduce((s, a) => s + a.price, 0) / articles.length)
      : 0;

    return NextResponse.json({
      articles,
      summary: {
        paid_count:    articles.length,
        total_revenue: totalRevenue,
        avg_price:     avgPrice,
      },
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'drafts directory not found' }, { status: 503 });
    }
    return NextResponse.json({ error: 'failed to read drafts' }, { status: 500 });
  }
}
