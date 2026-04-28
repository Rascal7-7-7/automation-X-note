#!/usr/bin/env node
// Push local automation data to Neon DB.
// Run: node scripts/push-to-neon.js
// Auto-called by scheduler/index.js hourly.

import { neon } from '@neondatabase/serverless';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { existsSync } from 'fs';

const __dir = dirname(fileURLToPath(import.meta.url));
// Load .env.local first, fallback to .env
const envLocal = join(__dir, '..', '.env.local');
const envFile  = join(__dir, '..', '.env');
config({ path: existsSync(envLocal) ? envLocal : envFile });
const ROOT = join(__dir, '..', '..');       // automation/
const DISPATCH = '/tmp/automation-dispatch';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Copy .env.local and set the value.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// ── helpers ──────────────────────────────────────────────

async function safeJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

async function safeText(path) {
  try { return await readFile(path, 'utf8'); }
  catch { return ''; }
}

async function safeDir(path) {
  try { return await readdir(path); }
  catch { return []; }
}

// ── pushers ──────────────────────────────────────────────

async function pushAlerts() {
  const txt = await safeText(join(ROOT, 'logs/alerts.log'));
  const lines = txt.trim().split('\n').filter(Boolean);
  let inserted = 0;

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); }
    catch { continue; }

    const { ts, level, title, message } = entry;
    if (!title && !message) continue;

    // Use ts+message as natural dedup key
    await sql`
      INSERT INTO alerts (severity, source, message, created_at)
      VALUES (
        ${level ?? 'INFO'},
        ${title ?? null},
        ${(message ?? title ?? '').slice(0, 2000)},
        ${ts ? new Date(ts) : new Date()}
      )
      ON CONFLICT DO NOTHING`;
    inserted++;
  }

  console.log(`alerts: ${inserted} rows processed`);
}

async function pushMetrics() {
  const dir = join(ROOT, 'analytics/reports');
  const files = await safeDir(dir);
  let inserted = 0;

  // x-summary
  const xSummary = await safeJson(join(dir, 'x-summary.json'));
  if (xSummary) {
    await sql`
      INSERT INTO metrics (key, value, meta, recorded_at)
      VALUES ('x.sampleSize', ${xSummary.sampleSize ?? 0}, ${JSON.stringify(xSummary)}, NOW())`;
    if (xSummary.promoVsNormal?.promoAvg != null) {
      await sql`
        INSERT INTO metrics (key, value, meta)
        VALUES ('x.promoAvgER', ${xSummary.promoVsNormal.promoAvg}, NULL)`;
    }
    inserted += 2;
  }

  // note-summary
  const noteSummary = await safeJson(join(dir, 'note-summary.json'));
  if (noteSummary) {
    await sql`
      INSERT INTO metrics (key, value, meta)
      VALUES ('note.sampleSize', ${noteSummary.sampleSize ?? 0}, ${JSON.stringify(noteSummary)})`;
    inserted++;
  }

  // daily-ai-trends — latest file only
  const trendFiles = files
    .filter(f => f.startsWith('daily-ai-trends') && f.endsWith('.json'))
    .sort();
  if (trendFiles.length) {
    const latest = await safeJson(join(dir, trendFiles[trendFiles.length - 1]));
    if (latest) {
      await sql`
        INSERT INTO metrics (key, value, meta)
        VALUES ('trends.latest', 1, ${JSON.stringify(latest)})`;
      inserted++;
    }
  }

  console.log(`metrics: ${inserted} rows inserted`);
}

async function pushPosts() {
  const files = await safeDir(DISPATCH);
  const doneFiles = files.filter(f => f.endsWith('.done.json'));
  let inserted = 0;

  for (const f of doneFiles) {
    const d = await safeJson(join(DISPATCH, f));
    if (!d) continue;

    const tab = f.replace('.done.json', '');
    const platform = tabToPlatform(tab);
    const items = Array.isArray(d.items) ? d.items : [JSON.stringify(d)];

    for (const item of items.slice(0, 5)) {
      await sql`
        INSERT INTO posts (platform, account, content, status)
        VALUES (${platform}, ${tab}, ${String(item).slice(0, 1000)}, 'done')
        ON CONFLICT DO NOTHING`;
      inserted++;
    }
  }

  console.log(`posts: ${inserted} rows processed`);
}

function tabToPlatform(tab) {
  if (tab.startsWith('X')) return 'x';
  if (tab.startsWith('note')) return 'note';
  if (tab.startsWith('Insta')) return 'instagram';
  if (tab.startsWith('YT')) return 'youtube';
  if (tab.startsWith('Ghost')) return 'ghost';
  return 'system';
}

// ── main ─────────────────────────────────────────────────

async function main() {
  console.log(`[push-to-neon] ${new Date().toISOString()}`);
  await Promise.all([pushAlerts(), pushMetrics(), pushPosts()]);
  console.log('[push-to-neon] done');
}

main().catch(err => { console.error(err); process.exit(1); });
