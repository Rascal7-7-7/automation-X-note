import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const account  = searchParams.get('account');
  const key      = searchParams.get('key');
  const days     = Math.min(parseInt(searchParams.get('days') ?? '30'), 90);

  const rows = await sql`
    SELECT id, platform, account, metric_key, value, recorded_at
    FROM sns_metrics
    WHERE
      (${platform}::text IS NULL OR platform = ${platform})
      AND (${account}::text IS NULL OR account = ${account})
      AND (${key}::text IS NULL OR metric_key = ${key})
      AND recorded_at > NOW() - (${days} || ' days')::interval
    ORDER BY recorded_at ASC
    LIMIT 2000`;

  return NextResponse.json({ metrics: rows });
}
