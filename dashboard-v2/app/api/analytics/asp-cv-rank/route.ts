import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';
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

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  try {
    const root = process.env.AUTOMATION_ROOT ?? path.resolve(process.cwd(), '..');
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, 'instagram', 'asp-campaigns.json'), 'utf8'),
    ) as CampaignFile;

    const rows = raw.campaigns
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

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[analytics/asp-cv-rank]', err);
    return NextResponse.json({ error: 'read failed' }, { status: 503 });
  }
}
