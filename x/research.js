/**
 * X リサーチモジュール（Playwright版）
 *
 * X API 不要 — ブラウザで x.com を操作して検索・スコアリング
 * API 取得後は pipeline.js の postTweet が自動で API に切り替わる（research はそのまま）
 *
 * 3ドメイン構成:
 *   AI系        — Claude / ChatGPT / 生成AI / LLM
 *   個人開発系  — 個人開発 / 副業エンジニア / SaaS
 *   金融系      — NISA / 投資 / 資産運用
 */
import 'dotenv/config';
import { getXBrowser } from './browser-client.js';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:research';

const mainQ = new FileQueue(path.join(__dirname, 'queue/main.jsonl'));

// ── ドメイン別キーワード ─────────────────────────────────────────
export const DOMAIN_KEYWORDS = {
  ai:      ['Claude Code 副業', 'ChatGPT 稼ぐ', 'AI副業', '生成AI 収入', 'AI活用 実績'],
  dev:     ['副業エンジニア', 'note 収益化', 'AI自動化 収入', '個人開発 稼ぐ', 'フリーランス AI'],
  content: ['AI 記事生成', 'note AI', 'AIライティング 副業', 'Claude 副業', 'ChatGPT note'],
};

// ── セレクタ ─────────────────────────────────────────────────────
const SEL = {
  tweet:    'article[data-testid="tweet"]',
  text:     '[data-testid="tweetText"]',
  likeBtn:  '[data-testid="like"]',
  rtBtn:    '[data-testid="retweet"]',
};

/** ツイートの数値（like / RT）を span テキストから取得 */
async function getCount(el, testId) {
  try {
    const btn = el.locator(`[data-testid="${testId}"]`);
    const spans = await btn.locator('span').allTextContents();
    for (const s of spans) {
      const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(n)) return n;
    }
  } catch { /* ignore */ }
  return 0;
}

/** 1キーワード分の検索結果を取得 */
async function searchKeyword(page, keyword, domain) {
  const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&f=live&lang=ja`;
  logger.info(MODULE, `searching: "${keyword}" (${domain})`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(3_000); // SPA レンダリング待機

  const articles = await page.locator(SEL.tweet).all();
  const results  = [];

  for (const article of articles.slice(0, 8)) {
    try {
      const text  = await article.locator(SEL.text).textContent().catch(() => '');
      const likes = await getCount(article, 'like');
      const rts   = await getCount(article, 'retweet');
      const score = likes + rts * 2;

      if (text.trim()) {
        results.push({ keyword, domain, text: text.trim(), likes, rts, score });
      }
    } catch { /* ツイート単位のエラーはスキップ */ }
  }

  logger.info(MODULE, `  → ${results.length} tweets (${domain})`);
  return results;
}

// ── メイン ───────────────────────────────────────────────────────
export async function runResearch(keywords) {
  // scheduler から keywords が渡された場合はそのまま使用
  // 渡されない場合は全ドメインを網羅
  const targets = keywords
    ? keywords.map(kw => ({ kw, domain: 'custom' }))
    : [
        ...DOMAIN_KEYWORDS.ai.map(kw      => ({ kw, domain: 'ai' })),
        ...DOMAIN_KEYWORDS.dev.map(kw     => ({ kw, domain: 'dev' })),
        ...DOMAIN_KEYWORDS.content.map(kw => ({ kw, domain: 'content' })),
      ];

  const { browser, page } = await getXBrowser({ headless: true });
  const allResults = [];

  try {
    for (const { kw, domain } of targets) {
      const results = await searchKeyword(page, kw, domain);
      allResults.push(...results);
      await page.waitForTimeout(1_500); // キーワード間に間隔を置く
    }
  } finally {
    await browser.close();
  }

  // スコア上位をドメインごとに均等にキューへ
  const byDomain = {};
  for (const r of allResults) {
    (byDomain[r.domain] = byDomain[r.domain] ?? []).push(r);
  }

  let queued = 0;
  for (const [domain, items] of Object.entries(byDomain)) {
    const top = items.sort((a, b) => b.score - a.score).slice(0, 2);
    for (const item of top) {
      await mainQ.push({ source: 'x-research', ...item });
      queued++;
      logger.info(MODULE, `queued [${domain}] "${item.keyword}" score:${item.score}`);
    }
  }

  logger.info(MODULE, `research done. total queued: ${queued}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keywords = process.argv.slice(2).length ? process.argv.slice(2) : null;
  runResearch(keywords);
}
