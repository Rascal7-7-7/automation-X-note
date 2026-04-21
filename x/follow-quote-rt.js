/**
 * フォロー中アカウントのバズ投稿を引用RT
 * - ホームタイムライン (Playwright) から高スコアツイートを収集
 * - Claude でコメント生成
 * - xurl quote / twitter-api-v2 で投稿
 * - 1日最大2件
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { getXBrowser } from './browser-client.js';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:follow-quote-rt';

const QUOTED_LOG = path.join(__dirname, 'queue/follow_quoted.jsonl');
const DAILY_MAX  = 2;

const SYSTEM = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
以下のルールで引用RTのコメントを1件作成してください：
- 80〜120文字（日本語）
- フォロー中のアカウントの投稿に対して、自分なりの視点・洞察・補足を加える
- 「確かに」「同感」などの単純な同意は禁止。読者が価値を感じる独自の視点を入れる
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
      if (entry.quotedAt && new Date(entry.quotedAt).toDateString() === today) todayCount++;
    } catch { /* skip */ }
  }
  return { ids, todayCount };
}

function recordQuoted(tweetId, commentary, quoteTweetId) {
  const entry = JSON.stringify({ tweetId, commentary, quoteTweetId, quotedAt: new Date().toISOString() });
  fs.appendFileSync(QUOTED_LOG, entry + '\n');
}

// ── ホームタイムライン収集 ─────────────────────────────────────────

async function scrapeHomeTimeline(page) {
  logger.info(MODULE, 'navigating to home timeline');
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await page.waitForTimeout(4_000);

  // 「おすすめ」ではなく「フォロー中」タブに切り替え
  const followingTab = page.locator('[role="tab"]', { hasText: 'フォロー中' });
  if (await followingTab.count() > 0) {
    await followingTab.click();
    await page.waitForTimeout(3_000);
  }

  // スクロールして多めに取得
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('End');
    await page.waitForTimeout(1_500);
  }

  const articles = await page.locator('article[data-testid="tweet"]').all();
  const results  = [];

  for (const article of articles.slice(0, 30)) {
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
      if (!text.trim()) continue;

      // リツイートや広告はスキップ
      const socialContext = await article.locator('[data-testid="socialContext"]').textContent().catch(() => '');
      if (socialContext.includes('リポスト') || socialContext.includes('プロモーション')) continue;

      const likes = await getMetricCount(article, 'like');
      const rts   = await getMetricCount(article, 'retweet');
      const score = likes + rts * 2;

      results.push({ id: tweetId, text: text.trim(), score, likes, rts });
    } catch { /* skip */ }
  }

  logger.info(MODULE, `scraped ${results.length} tweets from following timeline`);
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

// ── xurl / twitter-api-v2 ─────────────────────────────────────────

let _xurlAvailable = null;
function isXurlAvailable() {
  if (_xurlAvailable === null) {
    try { execFileSync('xurl', ['--version'], { stdio: 'pipe' }); _xurlAvailable = true; }
    catch { _xurlAvailable = false; }
  }
  return _xurlAvailable;
}

async function postQuoteRT(tweetId, commentary) {
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

// ── メイン ────────────────────────────────────────────────────────

export async function runFollowQuoteRT(opts = {}) {
  const scoreThreshold = opts.scoreThreshold ?? 30;

  const { ids: quotedIds, todayCount } = loadQuoted();
  if (todayCount >= DAILY_MAX) {
    logger.info(MODULE, `daily limit reached (${DAILY_MAX}/day), skipping`);
    return { quoted: 0, reason: 'daily_limit' };
  }

  const remaining = DAILY_MAX - todayCount;
  let count = 0;

  const { browser, page } = await getXBrowser({ headless: true });
  try {
    const tweets = await scrapeHomeTimeline(page);
    const targets = tweets
      .filter(t => !quotedIds.has(t.id) && t.score >= scoreThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, remaining);

    logger.info(MODULE, `${targets.length} quote-RT candidates (threshold:${scoreThreshold})`);

    for (const tweet of targets) {
      try {
        const commentary = await generate(SYSTEM, `以下のツイートを引用RTするコメントを作成してください。\nツイート: ${tweet.text}`, { maxTokens: 250 });
        logger.info(MODULE, `commentary: ${commentary}`);

        const result = await postQuoteRT(tweet.id, commentary);
        const quoteTweetId = result?.data?.id ?? result?.id;
        recordQuoted(tweet.id, commentary, quoteTweetId);
        count++;
        logger.info(MODULE, `quoted tweet:${tweet.id} → new:${quoteTweetId} (score:${tweet.score})`);
        await page.waitForTimeout(2_000);
      } catch (err) {
        logger.warn(MODULE, `failed for ${tweet.id}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  logger.info(MODULE, `done. quoted: ${count}`);
  return { quoted: count };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFollowQuoteRT();
}
