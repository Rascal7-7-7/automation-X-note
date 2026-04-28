import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { checkAuth } from '@/lib/auth';

interface TokenInfo {
  account: string;
  expiresAt: string | null;
  daysLeft: number | null;
  status: 'ok' | 'warn' | 'expired' | 'unknown';
}

export async function GET(req: Request) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const ROOT = process.env.AUTOMATION_ROOT;
  if (!ROOT) return NextResponse.json({ error: 'AUTOMATION_ROOT not set' }, { status: 503 });

  const accounts = ['account1', 'account2', 'account3'];
  const results: TokenInfo[] = await Promise.all(
    accounts.map(async (acct): Promise<TokenInfo> => {
      try {
        const raw = await readFile(join(ROOT, 'instagram', 'sessions', `${acct}.json`), 'utf-8');
        const data = JSON.parse(raw) as { expiresAt?: string; token_expiry?: string };
        const expiresAt = data.expiresAt ?? data.token_expiry ?? null;
        if (!expiresAt) return { account: acct, expiresAt: null, daysLeft: null, status: 'unknown' };
        const daysLeft = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
        const status = daysLeft <= 0 ? 'expired' : daysLeft <= 7 ? 'warn' : 'ok';
        return { account: acct, expiresAt, daysLeft, status };
      } catch {
        return { account: acct, expiresAt: null, daysLeft: null, status: 'unknown' };
      }
    })
  );
  return NextResponse.json({ tokens: results });
}
