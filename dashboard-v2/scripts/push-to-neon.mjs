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

// ── sns_metrics ───────────────────────────────────────────

async function pushSnsMetrics() {
  let inserted = 0;

  // quality-feedback.json → instagram avgScore per account
  const qf = await safeJson(join(ROOT, 'analytics/quality-feedback.json'));
  if (qf) {
    for (const [key, entries] of Object.entries(qf)) {
      if (!Array.isArray(entries)) continue;
      const platform = key.includes('instagram') ? 'instagram' : key.includes('x') ? 'x' : key.split('-')[0];
      const account  = key.includes('-') ? key.split('-').slice(1).join('-') : 'default';
      for (const e of entries) {
        if (e?.avgScore == null) continue;
        await sql`
          INSERT INTO sns_metrics (platform, account, metric_key, value, recorded_at)
          VALUES (
            ${platform}, ${account}, 'avgScore',
            ${Math.round(e.avgScore * 100)},
            ${e.ts ? new Date(e.ts) : new Date()}
          )
          ON CONFLICT (platform, account, metric_key, recorded_date)
          DO NOTHING`;
        inserted++;
      }
    }
  }

  // x-summary → promoAvgER / normalAvgER for account 'rascal_ai'
  const xs = await safeJson(join(ROOT, 'analytics/reports/x-summary.json'));
  if (xs?.promoVsNormal) {
    const { promoAvg, normalAvg } = xs.promoVsNormal;
    if (promoAvg != null) {
      await sql`
        INSERT INTO sns_metrics (platform, account, metric_key, value)
        VALUES ('x', 'rascal_ai', 'promoAvgER', ${Math.round(promoAvg * 100)})
        ON CONFLICT (platform, account, metric_key, recorded_date)
        DO NOTHING`;
      inserted++;
    }
    if (normalAvg != null) {
      await sql`
        INSERT INTO sns_metrics (platform, account, metric_key, value)
        VALUES ('x', 'rascal_ai', 'normalAvgER', ${Math.round(normalAvg * 100)})
        ON CONFLICT (platform, account, metric_key, recorded_date)
        DO NOTHING`;
      inserted++;
    }
  }

  // note-summary → sampleSize as proxy for note acct1
  const ns = await safeJson(join(ROOT, 'analytics/reports/note-summary.json'));
  if (ns?.sampleSize != null) {
    await sql`
      INSERT INTO sns_metrics (platform, account, metric_key, value)
      VALUES ('note', 'acct1', 'sampleSize', ${ns.sampleSize})
      ON CONFLICT (platform, account, metric_key, recorded_date)
      DO NOTHING`;
    inserted++;
  }

  console.log(`sns_metrics: ${inserted} rows processed`);
}

// ── post_metrics ──────────────────────────────────────────

async function pushPostMetrics() {
  let inserted = 0;

  // note drafts → likes proxy (price > 0 = paid, treat as engagement signal)
  const noteDir = join(ROOT, 'note/drafts');
  const noteFiles = (await safeDir(noteDir)).filter(f => f.endsWith('.json'));
  for (const f of noteFiles) {
    const d = await safeJson(join(noteDir, f));
    if (!d?.title || !d?.createdAt) continue;
    const postId = f.replace('.json', '').slice(0, 64);
    if (d.price != null) {
      await sql`
        INSERT INTO post_metrics (platform, post_id, account, metric_key, value, snapshot_at)
        VALUES ('note', ${postId}, 'acct1', 'price', ${d.price ?? 0}, 'total')
        ON CONFLICT (platform, post_id, metric_key, snapshot_at)
        DO NOTHING`;
      inserted++;
    }
  }

  // instagram drafts → status as proxy metric
  for (const acct of ['account1', 'account2']) {
    const baseDir = join(ROOT, 'instagram/drafts', acct);
    const dateDirs = await safeDir(baseDir);
    for (const dd of dateDirs) {
      const files = (await safeDir(join(baseDir, dd))).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const d = await safeJson(join(baseDir, dd, f));
        if (!d) continue;
        const postId = f.replace('.json', '').slice(0, 64);
        const val = d.status === 'posted' ? 1 : 0;
        await sql`
          INSERT INTO post_metrics (platform, post_id, account, metric_key, value, snapshot_at)
          VALUES ('instagram', ${postId}, ${acct}, 'posted', ${val}, 'total')
          ON CONFLICT (platform, post_id, metric_key, snapshot_at)
          DO NOTHING`;
        inserted++;
      }
    }
  }

  console.log(`post_metrics: ${inserted} rows processed`);
}

// ── main ─────────────────────────────────────────────────

async function main() {
  console.log(`[push-to-neon] ${new Date().toISOString()}`);
  await Promise.all([pushAlerts(), pushMetrics(), pushPosts(), pushSnsMetrics(), pushPostMetrics()]);
  console.log('[push-to-neon] done');
}

main().catch(err => { console.error(err); process.exit(1); });
