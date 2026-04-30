import { sql } from './db';

/** DB-first kv read. Returns null if not found, DB unavailable, or data is empty container. */
export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const rows = await sql`SELECT data FROM kv_store WHERE key = ${key} LIMIT 1`;
    if (!rows.length) return null;
    const data = rows[0].data as T;
    if (data === null || data === undefined) return null;
    // Empty array/object → treat as absent so callers fall through to file fallback
    if (Array.isArray(data) && data.length === 0) return null;
    if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data as object).length === 0) return null;
    return data;
  } catch { /* DB unavailable — caller falls back to file */ }
  return null;
}

/** Upsert into kv_store. Throws on DB error. */
export async function kvSet(key: string, data: unknown): Promise<void> {
  try {
    await sql`
      INSERT INTO kv_store (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(data)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET data = EXCLUDED.data, updated_at = NOW()`;
  } catch (err) {
    console.error('[kvSet] failed', key, err);
    throw err;
  }
}
