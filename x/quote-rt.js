/**
 * X Quote Retweet Module
 * - Finds viral AI/tech tweets worth amplifying
 * - Generates insightful Japanese commentary (own perspective)
 * - Posts as quote retweet
 * - Daily limit: 3 quote RTs/day
 *
 * ⚠️ X の利用規約の範囲内で、自分のアカウントへの操作のみ行うこと
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { getBraveBrowser } from './browser-client.js';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { appendFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:quote-rt';

const QUOTED_LOG = path.join(__dirname, 'queue/quoted.jsonl');
const DAILY_MAX  = 3;

const QUOTE_SYSTEM = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
以下のルールで引用RTのコメントを1件作成してください：
- 80〜120文字（日本語）
- 自分なりの視点・解釈・補足情報を加える（単なる称賛は禁止）
- 読者が「なるほど」と思える独自の洞察を含める
- 宣伝・URL・自己PRは含めない
- ハッシュタグは関連性があれば4個まで（なくてもよい）
- 末尾に改行なし`;

// ── 引用済み管理 ───────────────────────────────────────────────────

function loadQuoted() {
  if (!fs.existsSync(QUOTED_LOG)) return { ids: new Set(), todayCount: 0 };
  const today = new Date().toDateString();
  let todayCount = 0;
  const ids = new Set();

  const lines = fs.readFileSync(QUOTED_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      ids.add(entry.tweetId);
      if (entry.quotedAt && new Date(entry.quotedAt).toDateString() === today) {
        todayCount++;
      }
    } catch { /* skip corrupt lines */ }
  }

  return { ids, todayCount };
}

function recordQuoted(tweetId, commentary, quoteTweetId) {
  const entry = JSON.stringify({
    tweetId,
    commentary,
    quoteTweetId,
    quotedAt: new Date().toISOString(),
  });
  appendFileSync(QUOTED_LOG, entry + '\n');
}

// ── Playwright 検索（xurl search 禁止のため）────────────────────

async function searchByPlaywright(page, keyword) {
  const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&f=live&lang=ja`;
  logger.info(MODULE, `playwright search: "${keyword}"`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(2_000);

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

async function xurlQuoteRT(tweetId, commentary) {
  if (isXurlAvailable()) {
    const raw = execFileSync('xurl', ['quote', tweetId, commentary], { encoding: 'utf8' });
    return JSON.parse(raw);
  }
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY, appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
  return client.v2.tweet(commentary, { quote_tweet_id: tweetId });
}

// ── コメント生成 ──────────────────────────────────────────────────

async function generateCommentary(tweetText) {
  const prompt = `以下のツイートを引用RTする際のコメントを1件作成してください。\nツイート: ${tweetText}`;
  return generate(QUOTE_SYSTEM, prompt, { maxTokens: 250, model: 'claude-sonnet-4-6' });
}

// ── メイン ────────────────────────────────────────────────────────

export async function runQuoteRT(keywords, opts = {}) {
  const scoreThreshold = opts.scoreThreshold ?? 20;
  const maxPerRun      = opts.maxPerRun ?? DAILY_MAX;

  const { ids: quotedIds, todayCount } = loadQuoted();

  if (todayCount >= DAILY_MAX) {
    logger.info(MODULE, `daily limit reached (${DAILY_MAX}/day), skipping`);
    return;
  }

  const remaining = Math.min(maxPerRun, DAILY_MAX - todayCount);
  let count = 0;

  const { browser, page } = await getBraveBrowser();

  try {
    for (const keyword of keywords) {
      if (count >= remaining) break;

      logger.info(MODULE, `searching for quote-RT targets: "${keyword}"`);
      const tweets = await searchByPlaywright(page, keyword);
      const sorted = tweets
        .filter(t => !quotedIds.has(t.id) && t.score >= scoreThreshold && t.text)
        .sort((a, b) => b.score - a.score);

      for (const tweet of sorted) {
        if (count >= remaining) break;

        try {
          const commentary = await generateCommentary(tweet.text);
          logger.info(MODULE, `generated commentary for ${tweet.id}`, { commentary });

          const result      = await xurlQuoteRT(tweet.id, commentary);
          const quoteTweetId = result?.data?.id ?? result?.id;
          recordQuoted(tweet.id, commentary, quoteTweetId);
          count++;
          logger.info(MODULE, `quote-RT done. original:${tweet.id} new:${quoteTweetId} (score:${tweet.score})`);
          await page.waitForTimeout(1_500);
        } catch (err) {
          logger.warn(MODULE, `quote-RT failed for ${tweet.id}: ${err.message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  logger.info(MODULE, `quote-RT run done. quoted: ${count}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keywords = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['AI活用', 'Claude', '生成AI', '個人開発'];

  runQuoteRT(keywords);
}
