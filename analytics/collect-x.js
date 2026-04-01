/**
 * X パフォーマンス収集
 * - x-posts.jsonl の posted ツイートのエンゲージメントを取得
 * - performance.jsonl に保存
 * - 無料APIでは impressions / clicks は取得不可のため null で記録
 */
import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import { readLog, logPerformance } from './logger.js';
import { logger } from '../shared/logger.js';
import { fileURLToPath } from 'url';

const MODULE = 'analytics:collect-x';

const client = new TwitterApi(process.env.X_BEARER_TOKEN);

export async function collectXMetrics() {
  const posts = readLog('x-posts.jsonl')
    .filter(p => p.status === 'posted' && p.tweetId);

  if (posts.length === 0) {
    logger.info(MODULE, 'no posts to collect metrics for');
    return;
  }

  // 直近30件のみ（API節約）
  const targets = posts.slice(-30);
  const ids = targets.map(p => p.tweetId);

  logger.info(MODULE, `fetching metrics for ${ids.length} tweets`);

  try {
    const response = await client.v2.tweets(ids, {
      'tweet.fields': ['public_metrics'],
    });

    for (const tweet of response.data ?? []) {
      const m = tweet.public_metrics;
      logPerformance({
        targetType: 'x',
        targetId: tweet.id,
        likes:       m.like_count       ?? 0,
        reposts:     m.retweet_count    ?? 0,
        replies:     m.reply_count      ?? 0,
        impressions: m.impression_count ?? null,
        clicks:      null, // 無料APIでは取得不可
      });
    }

    logger.info(MODULE, `collected metrics for ${response.data?.length ?? 0} tweets`);
  } catch (err) {
    logger.error(MODULE, 'metrics collection failed', { message: err.message });
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  collectXMetrics();
}
