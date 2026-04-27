/**
 * YouTube リサーチモジュール（Playwright版）
 *
 * YouTube API 不要 — ブラウザで youtube.com を操作して
 * トレンド動画・競合チャンネルのタイトル・タグを収集する
 *
 * 収集対象:
 *   - YouTube 急上昇（/feed/trending）
 *   - キーワード検索結果（上位10本）
 *   - 競合チャンネルの最新動画タイトル・再生数
 */
import 'dotenv/config';
import { withLightpanda } from '../shared/lightpanda.js';
import fs from 'fs';
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR  = path.join(__dirname, 'queue');
const MODULE     = 'youtube:research';

const SEARCH_KEYWORDS = [
  'Claude Code 使い方',
  'ChatGPT 活用法',
  '生成AI 副業',
  'AIツール おすすめ',
  'AI 自動化',
];

// ── メイン ──────────────────────────────────────────────────────────

export async function runResearch({ keywords } = {}) {
  const targets = keywords ?? SEARCH_KEYWORDS;
  if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

  try {
    const allResults = await withLightpanda(async (page) => {
      const acc = [];

      const trending = await scrapeTrending(page);
      acc.push(...trending);
      logger.info(MODULE, `trending: ${trending.length} videos`);

      for (const kw of targets) {
        const results = await searchKeyword(page, kw);
        acc.push(...results);
        logger.info(MODULE, `search "${kw}": ${results.length} videos`);
        await page.waitForTimeout(1_500);
      }

      return acc;
    });

    const top = allResults
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const reportPath = path.join(QUEUE_DIR, 'research.json');
    saveJSON(reportPath, {
      date: new Date().toISOString().split('T')[0],
      total: top.length,
      videos: top,
    });

    logger.info(MODULE, `research done → ${reportPath}`);
    return { total: top.length, videos: top };
  } catch (err) {
    logger.error(MODULE, `research failed: ${err.message}`);
    return { total: 0, videos: [], error: err.message };
  }
}

// ── スクレイピング ────────────────────────────────────────────────────

async function scrapeTrending(page) {
  await page.goto('https://www.youtube.com/feed/trending', {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  });
  await page.waitForTimeout(3_000);

  return scrapeVideoItems(page, 'trending');
}

async function searchKeyword(page, keyword) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=CAISAhAB`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(2_500);

  return scrapeVideoItems(page, keyword);
}

async function scrapeVideoItems(page, source) {
  const items = await page.evaluate(() => {
    const results = [];
    const renderers = document.querySelectorAll('ytd-video-renderer, ytd-rich-item-renderer');

    for (const el of Array.from(renderers).slice(0, 10)) {
      const titleEl   = el.querySelector('#video-title');
      const metaEl    = el.querySelector('#metadata-line span, ytd-video-meta-block span');
      const channelEl = el.querySelector('#channel-name a, .ytd-channel-name a');
      const linkEl    = el.querySelector('a#thumbnail');

      const title      = titleEl?.textContent?.trim() ?? '';
      const metaText   = metaEl?.textContent?.trim() ?? '';
      const channelName = channelEl?.textContent?.trim() ?? '';
      const href       = linkEl?.href ?? '';
      const videoId    = href.match(/[?&]v=([^&]+)/)?.[1] ?? '';

      // 視聴回数をスコアに変換
      const viewMatch = metaText.match(/([\d,.]+)\s*(万|[KMk])?/);
      let score = 0;
      if (viewMatch) {
        const num = parseFloat(viewMatch[1].replace(/,/g, ''));
        const unit = viewMatch[2];
        score = unit === '万' ? num * 10000
              : unit === 'M' || unit === 'm' ? num * 1000000
              : unit === 'K' || unit === 'k' ? num * 1000
              : num;
      }

      if (title && videoId) {
        results.push({ title, channelName, videoId, meta: metaText, score });
      }
    }
    return results;
  });

  return items.map(item => ({ ...item, source }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keywords = process.argv.slice(2).length ? process.argv.slice(2) : undefined;
  runResearch({ keywords });
}
