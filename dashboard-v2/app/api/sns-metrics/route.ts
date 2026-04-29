import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { checkAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const account  = searchParams.get('account');
  const key      = searchParams.get('key');
  const days     = Math.min(parseInt(searchParams.get('days') ?? '30') || 30, 90);

  const rows = await sql`
    SELECT id, platform, account, metric_key, value, recorded_at, recorded_date
    FROM sns_metrics
    WHERE
      (${platform}::text IS NULL OR platform = ${platform})
      AND (${account}::text IS NULL OR account = ${account})
      AND (${key}::text IS NULL OR metric_key = ${key})
      AND recorded_at > NOW() - (${days} * INTERVAL '1 day')
    ORDER BY recorded_at ASC
    LIMIT 2000`;

  return NextResponse.json({ metrics: rows });
}
