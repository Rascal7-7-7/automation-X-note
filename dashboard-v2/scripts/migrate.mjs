import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envLocal = join(__dir, '..', '.env.local');
const envFile  = join(__dir, '..', '.env');
config({ path: existsSync(envLocal) ? envLocal : envFile });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

// ── posts: add new columns (idempotent) ───────────────────
await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_url    TEXT`;
await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`;
await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`;
await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS metadata     JSONB`;
await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW()`;
// index for pending queue
await sql`CREATE INDEX IF NOT EXISTS idx_posts_pending ON posts(status, created_at DESC) WHERE status = 'pending'`;
console.log('posts: columns added');

// ── sns_metrics / post_metrics: drop & recreate ───────────
// (recorded_date DATE avoids IMMUTABLE issue with date_trunc on TIMESTAMPTZ)
await sql`DROP TABLE IF EXISTS sns_metrics CASCADE`;
await sql`DROP TABLE IF EXISTS post_metrics CASCADE`;

await sql`CREATE TABLE sns_metrics (
  id            SERIAL PRIMARY KEY,
  platform      TEXT NOT NULL,
  account       TEXT NOT NULL,
  metric_key    TEXT NOT NULL,
  value         BIGINT NOT NULL,
  recorded_at   TIMESTAMP DEFAULT NOW(),
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (platform, account, metric_key, recorded_date)
)`;

await sql`CREATE TABLE post_metrics (
  id          SERIAL PRIMARY KEY,
  platform    TEXT NOT NULL,
  post_id     TEXT NOT NULL,
  account     TEXT,
  metric_key  TEXT NOT NULL,
  value       NUMERIC NOT NULL,
  snapshot_at TEXT DEFAULT 'total',
  recorded_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (platform, post_id, metric_key, snapshot_at)
)`;

console.log('schema applied');
