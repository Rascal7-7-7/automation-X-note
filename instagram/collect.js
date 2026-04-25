/**
 * Instagram エンゲージメント収集
 *
 * Graph API で直近の投稿のインサイトを取得し
 * logs/analytics/insta-posts.jsonl に追記する
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR  = path.join(__dirname, '../../logs/analytics');
const MODULE    = 'instagram:collect';

const {
  INSTAGRAM_ACCESS_TOKEN,
  INSTAGRAM_BUSINESS_ACCOUNT_ID,
} = process.env;

export async function runCollect() {
  if (!INSTAGRAM_ACCESS_TOKEN || !INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    logger.warn(MODULE, 'Instagram credentials not set — skipping collect');
    return;
  }

  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

  const posts = await fetchRecentPosts();
  if (posts.length === 0) {
    logger.info(MODULE, 'no posts found');
    return;
  }

  const insights = await Promise.all(posts.map(fetchInsights));
  const records  = insights.filter(Boolean);

  for (const record of records) {
    fs.appendFileSync(
      path.join(LOGS_DIR, 'insta-posts.jsonl'),
      JSON.stringify(record) + '\n',
    );
  }

  logger.info(MODULE, `collected ${records.length} post insights`);
}

// ── Graph API ───────────────────────────────────────────────────────

async function fetchRecentPosts() {
  const url = new URL(
    `https://graph.facebook.com/v19.0/${INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`
  );
  url.searchParams.set('fields', 'id,timestamp,caption');
  url.searchParams.set('limit', '10');
  url.searchParams.set('access_token', INSTAGRAM_ACCESS_TOKEN);

  const res  = await fetch(url.toString());
  const json = await res.json();

  if (!json.data) {
    logger.error(MODULE, `fetchRecentPosts error: ${JSON.stringify(json)}`);
    return [];
  }
  return json.data;
}

async function fetchInsights(post) {
  const METRICS = 'impressions,reach,likes_count,comments_count,saved,profile_visits';
  const url = new URL(
    `https://graph.facebook.com/v19.0/${post.id}/insights`
  );
  url.searchParams.set('metric', METRICS);
  url.searchParams.set('access_token', INSTAGRAM_ACCESS_TOKEN);

  try {
    const res  = await fetch(url.toString());
    const json = await res.json();

    if (!json.data) return null;

    const metrics = Object.fromEntries(
      json.data.map(({ name, values }) => [name, values[0]?.value ?? 0])
    );

    return {
      postId:    post.id,
      timestamp: post.timestamp,
      ...metrics,
      collectedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error(MODULE, `fetchInsights(${post.id}): ${err.message}`);
    return null;
  }
}

// ── インサイト集計レポート ──────────────────────────────────────────

const REPORTS_DIR   = path.join(__dirname, '../analytics/reports');
const INSTA_JSONL   = path.join(LOGS_DIR, 'insta-posts.jsonl');
const INSTA_SUMMARY = path.join(REPORTS_DIR, 'instagram-summary.json');

export async function runInsights() {
  // JSONL が空なら先に collect を実行
  const hasData = fs.existsSync(INSTA_JSONL) && fs.statSync(INSTA_JSONL).size > 0;
  if (!hasData) {
    logger.info(MODULE, 'no insta-posts.jsonl — running collect first');
    await runCollect();
  }

  if (!fs.existsSync(INSTA_JSONL)) {
    logger.warn(MODULE, 'insta-posts.jsonl still missing after collect');
    return null;
  }

  // JSONL を読んで postId ごとに最新レコードを保持
  const lines   = fs.readFileSync(INSTA_JSONL, 'utf8').split('\n').filter(Boolean);
  const byPost  = {};
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (!byPost[r.postId] || r.collectedAt > byPost[r.postId].collectedAt) {
        byPost[r.postId] = r;
      }
    } catch { /* skip */ }
  }

  const records = Object.values(byPost);
  if (records.length === 0) {
    logger.warn(MODULE, 'no valid records in insta-posts.jsonl');
    return null;
  }

  const sum = (key) => records.reduce((acc, r) => acc + (r[key] ?? 0), 0);
  const avg = (key) => Math.round(sum(key) / records.length);

  const summary = {
    generatedAt:       new Date().toISOString(),
    postCount:         records.length,
    totalImpressions:  sum('impressions'),
    totalReach:        sum('reach'),
    totalSaved:        sum('saved'),
    totalLikes:        sum('likes_count'),
    totalComments:     sum('comments_count'),
    avgProfileVisits:  avg('profile_visits'),
    avgSaved:          avg('saved'),
    avgReach:          avg('reach'),
    topPost:           records.sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0))[0] ?? null,
  };

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(INSTA_SUMMARY, JSON.stringify(summary, null, 2));
  logger.info(MODULE, `instagram-summary.json written. posts:${records.length} saved:${summary.totalSaved}`);

  return summary;
}
