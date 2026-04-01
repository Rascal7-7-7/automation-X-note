/**
 * X いいねモジュール（Playwright版）
 * - キーワード検索でツイートを取得
 * - スコア閾値を超えたツイートにいいね
 * - 重複いいね防止のため処理済みIDを記録
 *
 * ⚠️ X の利用規約の範囲内で、自分のアカウントへの操作のみ行うこと
 */
import 'dotenv/config';
import { getXBrowser } from './browser-client.js';
import { logger } from '../shared/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:like';
const LIKED_LOG = path.join(__dirname, 'queue/liked.json');

const SEL = {
  tweet:    'article[data-testid="tweet"]',
  text:     '[data-testid="tweetText"]',
  likeBtn:  '[data-testid="like"]',
  likedBtn: '[data-testid="unlike"]',
};

function loadLiked() {
  if (!fs.existsSync(LIKED_LOG)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(LIKED_LOG, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveLiked(set) {
  const tmp = LIKED_LOG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify([...set]));
  fs.renameSync(tmp, LIKED_LOG);
}

/** ツイート要素からユニークIDを取得（href から抽出） */
async function getTweetId(article) {
  try {
    const links = await article.locator('a[href*="/status/"]').all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      const match = href?.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
  } catch { /* ignore */ }
  return null;
}

/** ツイートのスコア（like + RT*2）を取得 */
async function getScore(article) {
  let score = 0;
  try {
    for (const testId of ['like', 'retweet']) {
      const btn = article.locator(`[data-testid="${testId}"]`);
      const spans = await btn.locator('span').allTextContents().catch(() => []);
      for (const s of spans) {
        const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(n)) {
          score += testId === 'retweet' ? n * 2 : n;
          break;
        }
      }
    }
  } catch { /* ignore */ }
  return score;
}

export async function runLike(keywords, opts = {}) {
  const scoreThreshold = opts.scoreThreshold ?? 5;
  const maxPerRun      = opts.maxPerRun ?? 5;

  const liked = loadLiked();
  let count = 0;

  const { browser, page } = await getXBrowser({ headless: true });

  try {
    for (const keyword of keywords) {
      if (count >= maxPerRun) break;

      const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&f=live&lang=ja`;
      logger.info(MODULE, `searching for likes: "${keyword}"`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(3_000);

      const articles = await page.locator(SEL.tweet).all();

      for (const article of articles.slice(0, 10)) {
        if (count >= maxPerRun) break;

        try {
          const tweetId = await getTweetId(article);
          if (!tweetId) continue;
          if (liked.has(tweetId)) continue;

          // 既にいいね済みならスキップ
          const alreadyLiked = await article.locator(SEL.likedBtn).count();
          if (alreadyLiked > 0) {
            liked.add(tweetId);
            continue;
          }

          const score = await getScore(article);
          if (score < scoreThreshold) continue;

          // いいねボタンをクリック
          const likeBtn = article.locator(SEL.likeBtn);
          if (await likeBtn.count() === 0) continue;

          await likeBtn.click();
          await page.waitForTimeout(1_000);

          liked.add(tweetId);
          count++;
          logger.info(MODULE, `liked tweet ${tweetId} (score:${score})`);
        } catch (err) {
          logger.warn(MODULE, `like failed`, { message: err.message });
        }
      }

      await page.waitForTimeout(1_500);
    }
  } finally {
    await browser.close();
  }

  saveLiked(liked);
  logger.info(MODULE, `like run done. liked: ${count}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keywords = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['AI活用', 'Claude Code'];

  runLike(keywords);
}
