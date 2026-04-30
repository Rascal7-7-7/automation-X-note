/**
 * X スレッド投稿モジュール
 * - Claude でスレッド形式の記事（5〜7ツイート）を生成
 * - 1ツイート目を単体投稿し、残りを reply_to で連鎖させる
 * - レートリミット対応のため各ツイート間に 2 秒待機
 */
import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { appendFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scheduleSelfReply } from './post-self-reply.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const MODULE      = 'x:article';
const POSTED_LOG  = path.join(__dirname, 'queue/posted.jsonl');
const BUZZ_REPORT = path.join(__dirname, '../analytics/reports/x-summary.json');

// ── フォールバックトピック ─────────────────────────────────────────────
const THREAD_TOPICS = [
  'Claude Codeで副業する具体的な方法5選',
  'AI時代に月10万稼ぐためにやること',
  '副業で失敗する人がやりがちな3つのミス',
  'ChatGPTとClaudeの使い分け方【保存版】',
  '2026年最強の副業ツール7選',
];

const THREAD_SYSTEM = `副業・AI活用をテーマに、Xのスレッド投稿（5〜7ツイート）を作成してください。

【ルール】
- 1ツイート目: 「1/5」を末尾に付け、フック（読まずにいられない一言）
- 中間ツイート: 具体的な情報・数字・手順（2/5, 3/5, 4/5）
- 最後: 「保存して！」「リプで教えて」などのCTA（5/5）
- 各ツイートは130文字以内
- 絵文字は各ツイート1〜2個まで
- ハッシュタグは最後のツイートのみ4個まで（関連性があるもののみ）

出力形式（区切りは---）:
1ツイート目テキスト
---
2ツイート目テキスト
---
...`;

/** バズレポートまたは THREAD_TOPICS からトピックを選ぶ */
function pickTopic() {
  if (existsSync(BUZZ_REPORT)) {
    try {
      const report = JSON.parse(readFileSync(BUZZ_REPORT, 'utf8'));
      const keywords = report?.topKeywords ?? [];
      if (keywords.length > 0) {
        const kw = keywords[Math.floor(Math.random() * keywords.length)];
        return `${kw}について副業・AI活用の観点でまとめたスレッド`;
      }
    } catch {
      // レポート読み込み失敗は無視してフォールバック
    }
  }
  return THREAD_TOPICS[Math.floor(Math.random() * THREAD_TOPICS.length)];
}

/** Claude でスレッドツイート配列を生成する */
async function generateThread(topic) {
  const userPrompt = `テーマ: ${topic}`;
  const raw = await generate(THREAD_SYSTEM, userPrompt, { maxTokens: 1200 });

  const tweets = raw
    .split(/\n---\n|^---$/m)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (tweets.length < 2) {
    throw new Error(`generated thread too short: ${tweets.length} tweet(s)`);
  }

  return tweets;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Twitter クライアント ──────────────────────────────────────────────
const twitterClient = new TwitterApi({
  appKey:       process.env.X_API_KEY,
  appSecret:    process.env.X_API_SECRET,
  accessToken:  process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

/**
 * スレッドを順次投稿する。
 * @param {string[]} tweets
 * @returns {Promise<string[]>} 投稿した tweetId の配列
 */
async function postThread(tweets) {
  const tweetIds = [];

  // 1 ツイート目は単体投稿
  const first = await twitterClient.v2.tweet(tweets[0]);
  const firstId = first?.data?.id ?? first?.id;
  tweetIds.push(firstId);
  logger.info(MODULE, 'posted 1st tweet', { tweetId: firstId });

  // 残りは reply_to で連鎖
  let replyToId = firstId;
  for (let i = 1; i < tweets.length; i++) {
    await sleep(2000); // レートリミット対応

    const res = await twitterClient.v2.tweet({
      text: tweets[i],
      reply: { in_reply_to_tweet_id: replyToId },
    });
    const tweetId = res?.data?.id ?? res?.id;
    tweetIds.push(tweetId);
    replyToId = tweetId;
    logger.info(MODULE, `posted tweet ${i + 1}/${tweets.length}`, { tweetId });
  }

  return tweetIds;
}

export async function runArticle() {
  const topic = pickTopic();
  logger.info(MODULE, 'selected topic', { topic });

  const tweets = await generateThread(topic);
  logger.info(MODULE, `generated ${tweets.length} tweets for thread`);

  const tweetIds = await postThread(tweets);
  logger.info(MODULE, 'thread posted', { tweetIds });

  appendFileSync(
    POSTED_LOG,
    JSON.stringify({
      type:      'thread',
      tweetIds,
      topic,
      tweets,
      postedAt:  new Date().toISOString(),
    }) + '\n',
  );

  // 2時間後に補足 self-reply をスケジュール
  if (tweetIds[0]) {
    scheduleSelfReply(tweetIds[0], 'article');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runArticle();
}
