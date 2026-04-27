/**
 * X Self-Reply Module
 * - 自分の直近24h投稿に来たリプライを取得
 * - Claude Haiku で返信文を生成
 * - xurl CLI または twitter-api-v2 でリプライ投稿
 * - replied-to.jsonl で重複スキップ
 * - 1回の実行で最大5返信（スパム回避）
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { appendFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBraveBrowser } from './browser-client.js';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:self-reply';

const REPLIED_TO_LOG  = path.join(__dirname, 'queue/replied-to.jsonl');
const POSTED_LOG      = path.join(__dirname, 'queue/posted.jsonl');
const MAX_PER_RUN     = 5;
const MAX_REPLIES_PER_TWEET = 3;
const LOOKBACK_MS     = 24 * 60 * 60 * 1000; // 24時間

const SELF_REPLY_SYSTEM = `あなたはAI副業・自動化を発信するXアカウントの中の人です。
フォロワーからのリプライに対して、温かく・価値ある短い返信を生成してください。
- 100文字以内
- 具体的な一言アドバイスか感謝
- 宣伝・URLは入れない
- 自然な話し言葉`;

// ── replied-to.jsonl 管理 ─────────────────────────────────────────

function loadRepliedTo() {
  if (!fs.existsSync(REPLIED_TO_LOG)) return new Set();
  const ids = new Set();
  const lines = fs.readFileSync(REPLIED_TO_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.replyTweetId) ids.add(entry.replyTweetId);
    } catch { /* skip corrupt lines */ }
  }
  return ids;
}

function recordRepliedTo(replyTweetId, parentTweetId, replyText) {
  const entry = JSON.stringify({
    replyTweetId,
    parentTweetId,
    replyText,
    repliedAt: new Date().toISOString(),
  });
  appendFileSync(REPLIED_TO_LOG, entry + '\n');
}

// ── 直近24h以内の自分のツイートID一覧を取得 ──────────────────────

function getRecentOwnTweetIds() {
  if (!fs.existsSync(POSTED_LOG)) return [];

  const cutoff = Date.now() - LOOKBACK_MS;
  const ids = [];

  const lines = fs.readFileSync(POSTED_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // postedAt は ISO文字列またはエポックms
      const postedTs = typeof entry.postedAt === 'string'
        ? new Date(entry.postedAt).getTime()
        : entry.postedAt;

      if (postedTs < cutoff) continue;

      // スレッド形式（tweetIds 配列）
      if (Array.isArray(entry.tweetIds) && entry.tweetIds.length > 0) {
        // スレッドの先頭ツイートIDのみリプライを確認
        ids.push(entry.tweetIds[0]);
      }
      // 単発ツイート（tweetId フィールド）
      if (entry.tweetId) {
        ids.push(entry.tweetId);
      }
    } catch { /* skip corrupt lines */ }
  }

  // 重複除去
  return [...new Set(ids)];
}

// ── xurl 可用性チェック ───────────────────────────────────────────

let _xurlAvailable = null;
function isXurlAvailable() {
  if (_xurlAvailable === null) {
    try {
      execFileSync('xurl', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
      _xurlAvailable = true;
    } catch { _xurlAvailable = false; }
  }
  return _xurlAvailable;
}

// ── リプライ投稿（xurl または twitter-api-v2）────────────────────

async function postReply(replyTweetId, text) {
  if (isXurlAvailable()) {
    const raw = execFileSync('xurl', ['reply', replyTweetId, text], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return JSON.parse(raw);
  }

  // フォールバック: twitter-api-v2
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey:       process.env.X_API_KEY,
    appSecret:    process.env.X_API_SECRET,
    accessToken:  process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
  return client.v2.tweet(text, { reply: { in_reply_to_tweet_id: replyTweetId } });
}

// ── Playwright でツイートページのリプライを取得 ───────────────────

async function fetchRepliesForTweet(page, tweetId) {
  const url = `https://x.com/i/web/status/${tweetId}`;
  logger.info(MODULE, `fetching replies for tweet ${tweetId}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForTimeout(3_000);
  } catch (err) {
    logger.warn(MODULE, `page load failed for ${tweetId}: ${err.message}`);
    return [];
  }

  // ページ上の全 article を取得（先頭が元ツイート、その後がリプライ）
  const articles = await page.locator('article[data-testid="tweet"]').all();
  if (articles.length <= 1) {
    logger.info(MODULE, `no replies found for tweet ${tweetId}`);
    return [];
  }

  const replies = [];
  // 先頭article（元ツイート自身）をスキップして最大 MAX_REPLIES_PER_TWEET 件取得
  for (const article of articles.slice(1, MAX_REPLIES_PER_TWEET + 1)) {
    try {
      // リプライのツイートID取得
      const links = await article.locator('a[href*="/status/"]').all();
      let replyTweetId = null;
      for (const link of links) {
        const href = await link.getAttribute('href');
        const m = href?.match(/\/status\/(\d+)/);
        if (m && m[1] !== tweetId) {
          replyTweetId = m[1];
          break;
        }
      }
      if (!replyTweetId) continue;

      // リプライ本文
      const text = await article
        .locator('[data-testid="tweetText"]')
        .first()
        .textContent()
        .catch(() => '');

      if (text.trim()) {
        replies.push({ replyTweetId, text: text.trim() });
      }
    } catch { /* skip article */ }
  }

  logger.info(MODULE, `  → ${replies.length} replies found for tweet ${tweetId}`);
  return replies;
}

// ── 返信文生成 ────────────────────────────────────────────────────

async function generateSelfReply(replyText) {
  const prompt = `以下のリプライに対する返信を1件作成してください（100文字以内）。\nリプライ: ${replyText}`;
  const raw = await generate(SELF_REPLY_SYSTEM, prompt, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 200,
  });
  // 100文字を超えた場合にトリム（念のため）
  return raw.trim().slice(0, 100);
}

// ── メインエクスポート ────────────────────────────────────────────

export async function runSelfReply(opts = {}) {
  const maxPerRun = opts.maxPerRun ?? MAX_PER_RUN;

  // 直近24h投稿IDを取得
  const ownTweetIds = getRecentOwnTweetIds();
  if (ownTweetIds.length === 0) {
    logger.info(MODULE, 'no own tweets in last 24h, skipping');
    return;
  }

  logger.info(MODULE, `own tweets to check: ${ownTweetIds.length}`, { ids: ownTweetIds });

  // 既返信済みIDをロード
  const repliedToIds = loadRepliedTo();

  let totalReplied = 0;
  const { browser, page } = await getBraveBrowser();

  try {
    for (const tweetId of ownTweetIds) {
      if (totalReplied >= maxPerRun) break;

      const replies = await fetchRepliesForTweet(page, tweetId);

      for (const { replyTweetId, text } of replies) {
        if (totalReplied >= maxPerRun) break;

        // 既返信済みスキップ
        if (repliedToIds.has(replyTweetId)) {
          logger.info(MODULE, `already replied to ${replyTweetId}, skipping`);
          continue;
        }

        try {
          const replyText = await generateSelfReply(text);
          logger.info(MODULE, `generated reply for ${replyTweetId}`, { replyText });

          await postReply(replyTweetId, replyText);
          recordRepliedTo(replyTweetId, tweetId, replyText);
          repliedToIds.add(replyTweetId); // インメモリも更新
          totalReplied++;

          logger.info(MODULE, `replied to ${replyTweetId} (parent: ${tweetId})`);

          // スパム回避インターバル
          await page.waitForTimeout(3_000);
        } catch (err) {
          logger.warn(MODULE, `failed to reply to ${replyTweetId}: ${err.message}`);
          // throw しない — 次のリプライへ続行
        }
      }
    }
  } finally {
    await browser.close();
  }

  logger.info(MODULE, `self-reply run done. replied: ${totalReplied}`);
}

// ── CLI直接実行 ───────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSelfReply();
}
