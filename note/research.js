/**
 * note リサーチモジュール
 *
 * フロー:
 *   1. Playwright で note.com 人気記事をスクレイプ
 *   2. 各記事の本文冒頭を取得（タイトル釣りを排除）
 *   3. 速度スコア: likes / (経過日数 + 1) でトレンド優先
 *   4. Claude Haiku でテーマ分析・5件提案 → 上位3件をキューに積む
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { generate } from '../shared/claude-client.js';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:research';

const ideaQueue = new FileQueue(path.join(__dirname, 'queue/ideas.jsonl'));

// 5カテゴリ × 複数タグのプール。毎回ランダムに4件選択してバランスよくリサーチ
const TAG_POOL = [
  // AI副業（収入・案件獲得）
  { url: 'https://note.com/hashtag/AI副業',        tag: 'AI副業',        category: 'ai-income'    },
  { url: 'https://note.com/hashtag/フリーランス',   tag: 'フリーランス',   category: 'ai-income'    },
  // AI×生産性（時短・自動化）
  { url: 'https://note.com/hashtag/AI活用',        tag: 'AI活用',        category: 'productivity' },
  { url: 'https://note.com/hashtag/生産性',        tag: '生産性',        category: 'productivity' },
  { url: 'https://note.com/hashtag/業務効率化',    tag: '業務効率化',    category: 'productivity' },
  // 初心者向けAI入門
  { url: 'https://note.com/hashtag/ChatGPT',      tag: 'ChatGPT',      category: 'ai-beginner'  },
  { url: 'https://note.com/hashtag/AI入門',        tag: 'AI入門',        category: 'ai-beginner'  },
  // インスタグラム・SNS運用
  { url: 'https://note.com/hashtag/Instagram運用', tag: 'Instagram運用', category: 'sns'          },
  { url: 'https://note.com/hashtag/SNS運用',       tag: 'SNS運用',       category: 'sns'          },
  // noteを使って稼ぐ方法
  { url: 'https://note.com/hashtag/副業',          tag: '副業',          category: 'note-income'  },
  { url: 'https://note.com/hashtag/note収益化',    tag: 'note収益化',    category: 'note-income'  },
];

/** カテゴリごとに1件ずつ（重複なし）ランダム選択して4件返す */
function selectScrapeTargets() {
  const categories = ['ai-income', 'productivity', 'ai-beginner', 'sns', 'note-income'];
  // 5カテゴリから4つをランダムに選び、各カテゴリから1タグをピック
  const shuffled = [...categories].sort(() => Math.random() - 0.5).slice(0, 4);
  return shuffled.map(cat => {
    const pool = TAG_POOL.filter(t => t.category === cat);
    return pool[Math.floor(Math.random() * pool.length)];
  });
}

const SELECTORS = {
  articleCard: [
    '[class*="NoteWrapper"] > a[href*="/n/"]',
    '[class*="noteWrapper"] > a[href*="/n/"]',
    '[class*="NoteItem"] a[href*="/n/"]',
    'a[href*="/n/"][aria-label]',
  ],
  likeCount: ['[class*="like"]', '[class*="Like"]'],
  publishedAt: ['time'],
};

async function trySelect(page, candidates) {
  for (const sel of candidates) {
    if (await page.locator(sel).count() > 0) return sel;
  }
  return null;
}

/** 記事詳細ページから本文冒頭を取得 */
async function scrapeArticleContent(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(1_000);
    const content = await page.locator('article').first().textContent();
    return content?.trim().slice(0, 500) ?? '';
  } catch {
    return '';
  }
}

/** 1一覧ページの記事カードを収集 */
async function scrapePage(page, tag) {
  const cardSel = await trySelect(page, SELECTORS.articleCard);
  if (!cardSel) {
    logger.warn(MODULE, `no cards: ${tag}`);
    return [];
  }

  const articles = [];
  const cards = await page.locator(cardSel).all();

  for (const card of cards.slice(0, 10)) {
    try {
      const href  = await card.getAttribute('href').catch(() => null);
      if (!href) continue;
      const url   = href.startsWith('http') ? href : `https://note.com${href}`;

      // タイトルはaria-labelから取得
      const title = await card.getAttribute('aria-label').catch(() => '') ?? '';

      // いいね数はカードの親要素から取得
      const parent = card.locator('..');
      const likeSel = await trySelect(page, SELECTORS.likeCount);
      const likeRaw = likeSel
        ? await parent.locator(likeSel).first().textContent().catch(() => '0')
        : '0';
      const likes = parseInt(likeRaw.replace(/[^0-9]/g, ''), 10) || 0;

      const velocity = likes / 8; // 日付取得困難のため固定値で正規化

      if (title.trim()) {
        articles.push({ tag, title: title.trim(), url, likes, velocity });
      }
    } catch { /* カード単位のエラーはスキップ */ }
  }

  return articles;
}

async function scrapeNoteArticles() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
    locale: 'ja-JP',
  });
  const page = await context.newPage();
  const allArticles = [];

  // 実行ごとにカテゴリをランダム選択（週3回の投稿でテーマが偏らないよう）
  const targets = selectScrapeTargets();
  logger.info(MODULE, `selected categories: ${targets.map(t => t.category).join(', ')}`);

  try {
    for (const target of targets) {
      logger.info(MODULE, `scraping: ${target.url}`);
      await page.goto(target.url, { waitUntil: 'networkidle', timeout: 20_000 });
      await page.waitForTimeout(1_500);

      const articles = await scrapePage(page, target.tag);

      // 速度スコア上位3件の本文を取得
      const topByVelocity = [...articles]
        .sort((a, b) => b.velocity - a.velocity)
        .slice(0, 3);

      for (const a of topByVelocity) {
        a.content = await scrapeArticleContent(page, a.url);
      }

      allArticles.push(...articles);
      logger.info(MODULE, `${articles.length} articles (${target.tag})`);
    }
  } finally {
    await browser.close();
  }

  return allArticles;
}

// ── テーマ合成 ────────────────────────────────────────────────────
const THEME_SYSTEM = `あなたはnoteクリエイター向けのコンテンツストラテジストです。
与えられた人気記事リスト（タイトル・本文抜粋・速度スコア付き）を分析し、
次の1週間に書くべき記事テーマを5件提案してください。
上位3件を採用します。

出力形式（JSONのみ）:
[
  {
    "theme": "記事テーマ（20文字以内）",
    "angle": "差別化できる切り口（30文字以内）",
    "targetWords": ["関連キーワード1", "関連キーワード2", "関連キーワード3"]
  }
]
条件:
- AI・副業・生産性の文脈
- 既存の人気記事と被らない独自の切り口
- 読者が今すぐ実践できる内容
JSON以外の文字は出力しないでください。`;

async function synthesizeThemes(articles) {
  const list = [...articles]
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 20)
    .map((a, i) => {
      const excerpt = a.content ? `\n   抜粋: ${a.content.slice(0, 100)}` : '';
      return `${i + 1}. [${a.tag}] ${a.title}（速度:${a.velocity.toFixed(1)}）${excerpt}`;
    })
    .join('\n');

  const raw = await generate(THEME_SYSTEM, `人気記事リスト:\n${list}`, { maxTokens: 768 });

  // コードブロック（```json ... ```）と生JSONの両パターンに対応
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const match = stripped.match(/\[[\s\S]*\]/);
  if (!match) {
    logger.warn(MODULE, 'theme JSON not found', { raw: raw.slice(0, 200) });
    return [];
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    logger.warn(MODULE, 'theme JSON parse failed');
    return [];
  }
}

// ── メイン ────────────────────────────────────────────────────────
export async function runResearch() {
  try {
    logger.info(MODULE, 'research start');

    const articles = await scrapeNoteArticles();
    if (articles.length === 0) {
      logger.warn(MODULE, 'no articles scraped');
      return;
    }

    const themes = await synthesizeThemes(articles);
    if (themes.length === 0) {
      logger.warn(MODULE, 'no themes generated');
      return;
    }

    const sourceUrls = articles
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 5)
      .map(a => a.url);

    // 上位3件のみキューに積む
    for (const t of themes.slice(0, 3)) {
      await ideaQueue.push({ ...t, sourceUrls });
      logger.info(MODULE, `queued: ${t.theme}`);
    }

    logger.info(MODULE, `research done. queued: ${Math.min(themes.length, 3)}`);
  } catch (err) {
    logger.error(MODULE, 'research failed', { message: err.message });
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runResearch();
}
