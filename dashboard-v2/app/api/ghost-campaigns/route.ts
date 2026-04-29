import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';

interface Campaign {
  id: string;
  name: string;
  category: string;
  commission: string;
  status: string;
  url: string | null;
  affiliateUrl: string;
  approval_status: '設定済み' | 'URL未設定';
  clicks: number;
  cv: number;
  cvr: string;
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  try {
    const raw = await readFile(join(ROOT, 'ghost', 'asp-campaigns.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const rawArr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.campaigns)
        ? (parsed as Record<string, unknown[]>).campaigns
        : [];
    const data = rawArr as Array<{
      id?: string;
      name?: string;
      productName?: string;
      category?: string;
      commission?: string;
      reward?: string;
      status?: string;
      active?: boolean;
      rejected?: boolean;
      url?: string | null;
      affiliateUrl?: string | null;
      clicks?: number;
      cv?: number;
      conversions?: number;
    }>;
    const campaigns: Campaign[] = data.map(c => {
      const clicks      = c.clicks ?? 0;
      const cv          = c.cv ?? c.conversions ?? 0;
      const cvr         = clicks > 0 ? ((cv / clicks) * 100).toFixed(1) + '%' : '—';
      const affiliateUrl = c.affiliateUrl ?? c.url ?? '';
      return {
        id:              c.id ?? '',
        name:            c.name ?? c.productName ?? '',
        category:        c.category ?? '',
        commission:      c.commission ?? c.reward ?? '',
        status:          c.status ?? (c.rejected ? 'rejected' : c.active ? 'active' : 'pending'),
        url:             affiliateUrl || null,
        affiliateUrl:    affiliateUrl,
        approval_status: affiliateUrl ? '設定済み' : 'URL未設定',
        clicks,
        cv,
        cvr,
      };
    });
    return NextResponse.json({ campaigns });
  } catch {
    return NextResponse.json({ campaigns: [] });
  }
}
