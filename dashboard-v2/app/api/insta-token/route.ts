import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';
import { kvGet } from '@/lib/kv';

interface TokenInfo {
  account: string;
  expiresAt: string | null;
  daysLeft: number | null;
  status: 'ok' | 'warn' | 'expired' | 'unknown';
}

const ACCOUNTS = ['account1', 'account2', 'account3'];

function computeTokenInfo(account: string, expiresAt: string | null | undefined): TokenInfo {
  if (!expiresAt) return { account, expiresAt: null, daysLeft: null, status: 'unknown' };
  const daysLeft = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  const status = daysLeft <= 0 ? 'expired' : daysLeft <= 7 ? 'warn' : 'ok';
  return { account, expiresAt, daysLeft, status };
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const kvData = await kvGet<Record<string, { expiresAt?: string; issuedAt?: string }>>('instagram:token-dates');
  if (kvData) {
    const tokens: TokenInfo[] = ACCOUNTS.map(acct =>
      computeTokenInfo(acct, kvData[acct]?.expiresAt),
    );
    return NextResponse.json({ tokens });
  }

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  const tokens: TokenInfo[] = await Promise.all(
    ACCOUNTS.map(async (acct): Promise<TokenInfo> => {
      try {
        const raw = await readFile(join(ROOT, 'instagram', 'sessions', `${acct}.json`), 'utf-8');
        const data = JSON.parse(raw) as { expiresAt?: string; token_expiry?: string };
        return computeTokenInfo(acct, data.expiresAt ?? data.token_expiry);
      } catch {
        return { account: acct, expiresAt: null, daysLeft: null, status: 'unknown' };
      }
    }),
  );
  return NextResponse.json({ tokens });
}
