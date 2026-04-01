/**
 * X 投稿パイプライン
 *
 * フロー: research → main queue → generate → validate → review → post
 *
 * review層:
 *   MODE=dev  → 生成結果を表示して終了（投稿しない）
 *   MODE=prod → AI自動レビュー通過後に投稿
 *
 * エクスポート:
 *   validateTweet / reviewTweet / postTweet は note-promo.js でも使用
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { TwitterApi } from 'twitter-api-v2';
import { FileQueue, processWithRetry } from '../shared/queue.js';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { canPost } from '../shared/daily-limit.js';
import { logXPost } from '../analytics/logger.js';
import { runResearch } from './research.js';
import { postTweetBrowser } from './post-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:pipeline';

// ── キュー ─────────────────────────────────────────────────────────
const mainQ   = new FileQueue(path.join(__dirname, 'queue/main.jsonl'));
const retryQ  = new FileQueue(path.join(__dirname, 'queue/retry.jsonl'));
const failedQ = new FileQueue(path.join(__dirname, 'queue/failed.jsonl'));

// ── Twitter クライアント（シングルトン） ───────────────────────────
const twitterClient = new TwitterApi({
  appKey:      process.env.X_API_KEY,
  appSecret:   process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

// ── ルールベース検証 ────────────────────────────────────────────────
const BANNED_WORDS = ['詐欺', '絶対儲かる', '100%成功', '必ず稼げる'];

export function validateTweet(text) {
  if (!text || text.trim().length === 0) return { ok: false, reason: 'empty' };
  if (text.length > 140)                 return { ok: false, reason: 'too long' };
  const hit = BANNED_WORDS.find(w => text.includes(w));
  if (hit)                               return { ok: false, reason: `banned: ${hit}` };
  return { ok: true };
}

// ── AI レビュー ─────────────────────────────────────────────────────
const REVIEW_SYSTEM = `あなたはSNS品質レビュアーです。
以下のツイートを評価し、JSONのみで返してください。
{"ok": true/false, "reason": "判断理由（20文字以内）"}
NGの条件: 誤情報の可能性 / 不快な表現 / 140文字超過 / 無関係な内容`;

export async function reviewTweet(text) {
  const raw = await generate(REVIEW_SYSTEM, `ツイート:\n${text}`, { maxTokens: 128 });
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return { ok: false, reason: 'invalid format' };
  try {
    return JSON.parse(match[0]);
  } catch {
    return { ok: false, reason: 'review parse error' };
  }
}

// ── 投稿 ────────────────────────────────────────────────────────────
export async function postTweet(text) {
  if (process.env.X_API_KEY) {
    const { data } = await twitterClient.v2.tweet(text);
    return data.id;
  }
  // X API 未設定時はブラウザ経由で投稿
  return postTweetBrowser(text);
}

// ── ツイート生成 ────────────────────────────────────────────────────
const TWEET_SYSTEM = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
以下のルールでツイートを1件作成してください：
- 140文字以内（日本語）
- 学びになる具体的な情報を含める
- ハッシュタグは2〜3個
- 宣伝・誇張・煽りは禁止
- 末尾に改行なし`;

async function generateTweet(item) {
  const prompt = `キーワード: ${item.keyword}\n参考ツイート: ${item.text ?? ''}`;
  return generate(TWEET_SYSTEM, prompt, { maxTokens: 300 });
}

// ── 公開 API ────────────────────────────────────────────────────────

/** Step1: リサーチしてキューに積む */
export async function enqueue(keywords) {
  await runResearch(keywords);
  logger.info(MODULE, `enqueue done. queue size: ${mainQ.size()}`);
}

/** Step2: キューから1件処理 */
export async function processQueue(opts = {}) {
  const isDev = (opts.mode ?? process.env.MODE ?? 'dev') === 'dev';

  const result = await processWithRetry(mainQ, retryQ, failedQ, async (item) => {
    const tweetText = await generateTweet(item);
    logger.info(MODULE, 'generated', {
      text: tweetText,
      keyword: item.keyword,
      attempts: item._attempts ?? 0,
    });

    const validation = validateTweet(tweetText);
    if (!validation.ok) {
      logger.warn(MODULE, `validate NG: ${validation.reason}`, { text: tweetText });
      throw new Error(`validate NG: ${validation.reason}`);
    }

    if (isDev) {
      console.log('\n--- DEV MODE: REVIEW REQUIRED BEFORE POSTING ---');
      console.log(tweetText);
      console.log('------------------------------------------------\n');
      return;
    }

    if (!canPost()) {
      logger.warn(MODULE, 'daily limit reached (max 5/day)');
      return;
    }

    const review = await reviewTweet(tweetText);
    if (!review.ok) {
      logger.warn(MODULE, `review NG: ${review.reason}`, { text: tweetText });
      throw new Error(`review NG: ${review.reason}`);
    }

    const tweetId = await postTweet(tweetText);
    logger.info(MODULE, `posted: ${tweetId}`);

    logXPost({
      tweetId,
      text: tweetText,
      keyword: item.keyword,
      type: 'normal',
      sourceTheme: item.keyword,
    });
  });

  if (!result) {
    logger.info(MODULE, 'queue empty, nothing to process');
  } else if (result && !result.ok) {
    logger.warn(MODULE, `processing failed: ${result.err?.message}`, {
      attempts: result.attempts,
    });
  }

  return result;
}
