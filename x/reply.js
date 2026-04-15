/**
 * X Auto-Reply Module
 * - Searches for high-engagement tweets about AI/副業/自動化
 * - Generates thoughtful reply using Claude Haiku
 * - Posts reply via xurl CLI
 * - Prevents duplicate replies (tracks replied tweet IDs)
 * - Daily limit: 10 replies/day
 *
 * ⚠️ X の利用規約の範囲内で、自分のアカウントへの操作のみ行うこと
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { getXBrowser } from './browser-client.js';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { appendFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:reply';

const REPLIED_LOG = path.join(__dirname, 'queue/replied.jsonl');
const DAILY_MAX   = 10;

const REPLY_SYSTEM = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
以下のルールでリプライ文を1件作成してください：
- 50〜100文字（日本語）
- 相手のツイート内容に具体的に言及して価値を添える
- 共感・補足・別視点のいずれかで会話を発展させる
- 宣伝・自己紹介・URLは絶対に含めない
- ハッシュタグ不要
- 末尾に改行なし`;

// ── 返信済み管理 ───────────────────────────────────────────────────

function loadReplied() {
  if (!fs.existsSync(REPLIED_LOG)) return { ids: new Set(), todayCount: 0, date: '' };
  const today = new Date().toDateString();
  let todayCount = 0;
  const ids = new Set();

  const lines = fs.readFileSync(REPLIED_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      ids.add(entry.tweetId);
      if (entry.repliedAt && new Date(entry.repliedAt).toDateString() === today) {
        todayCount++;
      }
    } catch { /* skip corrupt lines */ }
  }

  return { ids, todayCount, date: today };
}

function recordReplied(tweetId, replyText) {
  const entry = JSON.stringify({
    tweetId,
    replyText,
    repliedAt: new Date().toISOString(),
  });
  appendFileSync(REPLIED_LOG, entry + '\n');
}

// ── Playwright 検索（xurl search 禁止のため）────────────────────

async function searchByPlaywright(page, keyword) {
  const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&f=live&lang=ja`;
  logger.info(MODULE, `playwright search: "${keyword}"`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(3_000);

  const articles = await page.locator('article[data-testid="tweet"]').all();
  const results  = [];

  for (const article of articles.slice(0, 10)) {
    try {
      const links = await article.locator('a[href*="/status/"]').all();
      let tweetId = null;
      for (const link of links) {
        const href = await link.getAttribute('href');
        const m    = href?.match(/\/status\/(\d+)/);
        if (m) { tweetId = m[1]; break; }
      }
      if (!tweetId) continue;

      const text  = await article.locator('[data-testid="tweetText"]').textContent().catch(() => '');
      const likes = await getMetricCount(article, 'like');
      const rts   = await getMetricCount(article, 'retweet');
      const score = likes + rts * 2;

      if (text.trim()) results.push({ id: tweetId, text: text.trim(), score });
    } catch { /* skip */ }
  }

  logger.info(MODULE, `  → ${results.length} tweets found`);
  return results;
}

async function getMetricCount(el, testId) {
  try {
    const btn   = el.locator(`[data-testid="${testId}"]`);
    const spans = await btn.locator('span').allTextContents();
    for (const s of spans) {
      const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(n)) return n;
    }
  } catch { /* ignore */ }
  return 0;
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

// ── xurl ラッパー ─────────────────────────────────────────────────

async function xurlReply(tweetId, text) {
  if (isXurlAvailable()) {
    const raw = execFileSync('xurl', ['reply', tweetId, text], { encoding: 'utf8' });
    return JSON.parse(raw);
  }
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY, appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET,
  });
  return client.v2.tweet(text, { reply: { in_reply_to_tweet_id: tweetId } });
}

// ── 返信文生成 ────────────────────────────────────────────────────

async function generateReply(tweetText) {
  const prompt = `以下のツイートに対するリプライを1件作成してください。\nツイート: ${tweetText}`;
  return generate(REPLY_SYSTEM, prompt, { maxTokens: 200 });
}

// ── メイン ────────────────────────────────────────────────────────

export async function runReply(keywords, opts = {}) {
  const scoreThreshold = opts.scoreThreshold ?? 5;
  const maxPerRun      = opts.maxPerRun ?? DAILY_MAX;

  const { ids: repliedIds, todayCount } = loadReplied();

  if (todayCount >= DAILY_MAX) {
    logger.info(MODULE, `daily limit reached (${DAILY_MAX}/day), skipping`);
    return;
  }

  const remaining = Math.min(maxPerRun, DAILY_MAX - todayCount);
  let count = 0;

  const { browser, page } = await getXBrowser({ headless: true });

  try {
    for (const keyword of keywords) {
      if (count >= remaining) break;

      logger.info(MODULE, `searching for reply targets: "${keyword}"`);
      const tweets = await searchByPlaywright(page, keyword);
      const sorted = tweets
        .filter(t => !repliedIds.has(t.id) && t.score >= scoreThreshold && t.text)
        .sort((a, b) => b.score - a.score);

      for (const tweet of sorted) {
        if (count >= remaining) break;

        try {
          const replyText = await generateReply(tweet.text);
          logger.info(MODULE, `generated reply for ${tweet.id}`, { replyText });

          xurlReply(tweet.id, replyText);
          recordReplied(tweet.id, replyText);
          count++;
          logger.info(MODULE, `replied to tweet ${tweet.id} (score:${tweet.score})`);
          await page.waitForTimeout(2_000);
        } catch (err) {
          logger.warn(MODULE, `reply failed for ${tweet.id}: ${err.message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  logger.info(MODULE, `reply run done. replied: ${count}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keywords = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['AI活用', 'Claude', '副業', '自動化'];

  runReply(keywords);
}
