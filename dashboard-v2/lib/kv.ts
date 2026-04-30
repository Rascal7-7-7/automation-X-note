import { sql } from './db';

/** DB-first kv read. Returns parsed JSON or null if not found. */
export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const rows = await sql`SELECT data FROM kv_store WHERE key = ${key} LIMIT 1`;
    if (rows.length) return rows[0].data as T;
  } catch { /* DB unavailable — caller falls back to file */ }
  return null;
}

/** Upsert into kv_store. */
export async function kvSet(key: string, data: unknown): Promise<void> {
  await sql`
    INSERT INTO kv_store (key, data, updated_at)
    VALUES (${key}, ${JSON.stringify(data)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET data = EXCLUDED.data, updated_at = NOW()`;
}
