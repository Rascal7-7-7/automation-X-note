import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { checkAuth } from '@/lib/auth';
import { kvGet } from '@/lib/kv';

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

type RawCampaign = {
  id?: string; name?: string; productName?: string; category?: string;
  commission?: string; reward?: string; status?: string; active?: boolean;
  rejected?: boolean; url?: string | null; affiliateUrl?: string | null;
  clicks?: number; cv?: number; conversions?: number;
};

function mapCampaign(c: RawCampaign): Campaign {
  const clicks = Number.isFinite(c.clicks) ? (c.clicks as number) : 0;
  const cv = Number.isFinite(c.cv) ? (c.cv as number) : Number.isFinite(c.conversions) ? (c.conversions as number) : 0;
  const affiliateUrl = c.affiliateUrl ?? c.url ?? '';
  return {
    id: c.id ?? '', name: c.name ?? c.productName ?? '', category: c.category ?? '',
    commission: c.commission ?? c.reward ?? '',
    status: c.status ?? (c.rejected ? 'rejected' : c.active ? 'active' : 'pending'),
    url: affiliateUrl || null, affiliateUrl,
    approval_status: affiliateUrl ? '設定済み' : 'URL未設定',
    clicks, cv, cvr: clicks > 0 ? ((cv / clicks) * 100).toFixed(1) + '%' : '—',
  };
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const kvData = await kvGet<unknown>('ghost:asp-campaigns');
  if (kvData) {
    const rawArr = Array.isArray(kvData) ? kvData : Array.isArray((kvData as Record<string,unknown>)?.campaigns) ? (kvData as Record<string,unknown[]>).campaigns : [];
    const data = rawArr as Parameters<typeof mapCampaign>[0][];
    const campaigns = data.map(mapCampaign);
    return NextResponse.json({ campaigns, waiting_url_count: campaigns.filter(c => !c.affiliateUrl).length, last_sync: null });
  }

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  const safeBase = resolve(ROOT);
  const filePath = resolve(join(ROOT, 'ghost', 'asp-campaigns.json'));
  if (!filePath.startsWith(safeBase + '/')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 500 });
  }

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const rawArr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.campaigns)
        ? (parsed as Record<string, unknown[]>).campaigns
        : [];
    const campaigns = (rawArr as RawCampaign[]).map(mapCampaign);
    const fileStat = await stat(filePath).catch(() => null);
    const last_sync       = fileStat ? fileStat.mtime.toISOString() : null;
    const waiting_url_count = campaigns.filter(c => !c.affiliateUrl).length;

    return NextResponse.json({ campaigns, waiting_url_count, last_sync });
  } catch {
    return NextResponse.json({ campaigns: [], waiting_url_count: 0, last_sync: null });
  }
}
