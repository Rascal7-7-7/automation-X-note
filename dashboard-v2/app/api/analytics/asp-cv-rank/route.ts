import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';
import { kvGet } from '@/lib/kv';
import fs from 'fs';
import path from 'path';

interface Campaign {
  id: string;
  asp?: string;
  productName: string;
  category: string;
  reward: number;
  active?: boolean;
  rejected?: boolean;
  postedCount?: number;
  lastPostedAt?: string;
}

interface CampaignFile {
  campaigns: Campaign[];
}

function rankCampaigns(campaigns: Campaign[]) {
  return campaigns
    .filter(c => c.active !== false && !c.rejected)
    .map(c => ({
      id:               c.id,
      productName:      c.productName,
      asp:              c.asp ?? 'A8.net',
      category:         c.category,
      reward:           c.reward,
      postedCount:      c.postedCount ?? 0,
      estimatedRevenue: c.reward * (c.postedCount ?? 0),
      lastPostedAt:     c.lastPostedAt ?? null,
    }))
    .sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)
    .slice(0, 15);
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const kvData = await kvGet<CampaignFile | Campaign[]>('instagram:asp-campaigns');
  if (kvData) {
    const campaigns = Array.isArray(kvData) ? kvData : kvData.campaigns ?? [];
    return NextResponse.json({ rows: rankCampaigns(campaigns) });
  }

  try {
    const root = process.env.AUTOMATION_ROOT ?? path.resolve(process.cwd(), '..');
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, 'instagram', 'asp-campaigns.json'), 'utf8'),
    ) as CampaignFile;

    return NextResponse.json({ rows: rankCampaigns(raw.campaigns) });
  } catch (err) {
    console.error('[analytics/asp-cv-rank]', err);
    return NextResponse.json({ error: 'read failed' }, { status: 503 });
  }
}
