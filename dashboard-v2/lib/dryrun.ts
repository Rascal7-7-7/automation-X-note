import { sql } from './db';

export async function isDryRun(): Promise<boolean> {
  try {
    const rows = await sql`SELECT value FROM settings WHERE key = 'dry_run'`;
    const raw = rows[0]?.value;
    return raw === true || raw === 'true';
  } catch {
    return true; // safe default: dry run if settings table missing
  }
}

/**
 * Wraps fetch for Bridge Server calls.
 * In dry-run mode: logs intent and returns mock ok response without making network call.
 */
export async function safeBridgeFetch(
  url: string,
  options?: RequestInit,
): Promise<{ ok: boolean; dryRun: boolean; data?: unknown }> {
  const dry = await isDryRun();

  if (dry) {
    const body = options?.body ? String(options.body).slice(0, 200) : '';
    if (process.env.NODE_ENV !== 'production') console.log(`[DRY RUN] would POST ${url} — ${body}`);
    return { ok: true, dryRun: true };
  }

  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, dryRun: false, data };
}
