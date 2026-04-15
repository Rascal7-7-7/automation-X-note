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
