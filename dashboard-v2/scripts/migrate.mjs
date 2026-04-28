import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envLocal = join(__dir, '..', '.env.local');
const envFile  = join(__dir, '..', '.env');
config({ path: existsSync(envLocal) ? envLocal : envFile });

const sql = neon(process.env.DATABASE_URL);

// Drop and recreate cleanly (tables are new, no data loss)
await sql`DROP TABLE IF EXISTS sns_metrics CASCADE`;
await sql`DROP TABLE IF EXISTS post_metrics CASCADE`;

await sql`CREATE TABLE sns_metrics (
  id           SERIAL PRIMARY KEY,
  platform     TEXT NOT NULL,
  account      TEXT NOT NULL,
  metric_key   TEXT NOT NULL,
  value        BIGINT NOT NULL,
  recorded_at  TIMESTAMP DEFAULT NOW(),
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (platform, account, metric_key, recorded_date)
)`;

await sql`CREATE TABLE post_metrics (
  id            SERIAL PRIMARY KEY,
  platform      TEXT NOT NULL,
  post_id       TEXT NOT NULL,
  account       TEXT,
  metric_key    TEXT NOT NULL,
  value         NUMERIC NOT NULL,
  snapshot_at   TEXT DEFAULT 'total',
  recorded_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE (platform, post_id, metric_key, snapshot_at)
)`;

console.log('schema applied');
