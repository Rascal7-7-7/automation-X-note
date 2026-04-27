/**
 * X いいねモジュール（Playwright検索 + xurl like）
 *
 * xurl search は APIクレジット消費のため禁止。
 * 代わりに Playwright で x.com を直接スクレイピングしてツイートIDを取得し、
 * xurl like <id> でいいねを実行する。
 *
 * ⚠️ X の利用規約の範囲内で、自分のアカウントへの操作のみ行うこと
 */
import 'dotenv/config';
import { getBraveBrowser } from './browser-client.js';
import { logger } from '../shared/logger.js';
import fs from 'fs';
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE    = 'x:like';
const LIKED_LOG = path.join(__dirname, 'queue/liked.json');

// ── 処理済みID管理 ────────────────────────────────────────────────

function loadLiked() {
  if (!fs.existsSync(LIKED_LOG)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(LIKED_LOG, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveLiked(set) {
  const dir = path.dirname(LIKED_LOG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  saveJSON(LIKED_LOG, [...set], { pretty: false });
}

// ── Playwright でキーワード検索 → { id, score }[] を返す ─────────

async function searchByPlaywright(page, keyword) {
  const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&f=live&lang=ja`;
  logger.info(MODULE, `playwright search: "${keyword}"`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(3_000);

  const articles = await page.locator('article[data-testid="tweet"]').all();
  const results  = [];

  for (const article of articles.slice(0, 10)) {
    try {
      // ツイートURLから ID を抽出（/status/123456 のパターン）
      const links = await article.locator('a[href*="/status/"]').all();
      let tweetId = null;
      for (const link of links) {
        const href = await link.getAttribute('href');
        const m    = href?.match(/\/status\/(\d+)/);
        if (m) { tweetId = m[1]; break; }
      }
      if (!tweetId) continue;

      // スコア計算（like + RT×2）
      const likeCount = await getCount(article, 'like');
      const rtCount   = await getCount(article, 'retweet');
      const score     = likeCount + rtCount * 2;

      results.push({ id: tweetId, score });
    } catch { /* ツイート単位のエラーはスキップ */ }
  }

  logger.info(MODULE, `  → ${results.length} tweets found`);
  return results;
}

async function getCount(el, testId) {
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

// ── いいね（Playwright CDP クリック）────────────────────────────

async function playwrightLike(page, tweetId) {
  await page.goto(`https://x.com/i/web/status/${tweetId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  await page.waitForTimeout(2_000);

  const likeBtn = page.locator('[data-testid="like"]').first();
  const ariaPressed = await likeBtn.getAttribute('aria-pressed').catch(() => null);
  if (ariaPressed === 'true') return; // already liked

  await likeBtn.click();
  await page.waitForTimeout(1_000);
}

// ── メイン ────────────────────────────────────────────────────────

export async function runLike(keywords, opts = {}) {
  const scoreThreshold = opts.scoreThreshold ?? 0;
  const maxPerRun      = opts.maxPerRun      ?? 5;

  const liked = loadLiked();
  let count = 0;

  const { browser, page } = await getBraveBrowser();

  try {
    for (const keyword of keywords) {
      if (count >= maxPerRun) break;

      const tweets = await searchByPlaywright(page, keyword);
      const sorted = tweets
        .filter(t => !liked.has(t.id) && t.score >= scoreThreshold)
        .sort((a, b) => b.score - a.score);

      for (const tweet of sorted) {
        if (count >= maxPerRun) break;

        try {
          await playwrightLike(page, tweet.id);
          liked.add(tweet.id);
          count++;
          logger.info(MODULE, `liked tweet ${tweet.id} (score:${tweet.score})`);
        } catch (err) {
          logger.warn(MODULE, `like failed for ${tweet.id}: ${err.message}`);
        }

        await page.waitForTimeout(1_500); // いいね間隔
      }
    }
  } finally {
    await browser.close();
  }

  saveLiked(liked);
  logger.info(MODULE, `like run done. liked: ${count}`);
  return { count };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keywords = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['AI活用', 'Claude Code'];

  runLike(keywords);
}
