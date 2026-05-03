/**
 * note エンゲージメント収集
 *
 * フロー:
 *   1. note 公開 API で各アカウントの記事一覧（いいね数）を取得
 *   2. Playwright + Chrome Profile でダッシュボードの PV を取得
 *   3. analytics/reports/note-summary.json に保存
 *
 * 使い方: node analytics/collect-note.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveJSON } from '../shared/file-utils.js';
import { launchChromeProfileContext } from '../shared/browser-launch.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'analytics:note';
const REPORTS_DIR = path.join(__dirname, 'reports');

const ACCOUNTS = [
  { id: 1, username: 'rascal_ai_devops',  chromeProfile: 'Profile 1' },
  { id: 2, username: 'rascal_invest',     chromeProfile: 'Profile 2' },
  { id: 3, username: 'rascal_affiliate',  chromeProfile: 'Profile 3' },
];

// ── note 公開 API ─────────────────────────────────────────────────

async function fetchPublicStats(username) {
  const articles = [];
  let page = 1;
  while (page <= 5) {
    const url = `https://note.com/api/v2/creators/${username}/contents?kind=note&page=${page}&per=20`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items = data?.data?.contents ?? [];
      if (items.length === 0) break;
      for (const item of items) {
        articles.push({
          id:        item.id,
          key:       item.key,
          title:     item.name,
          likeCount: item.likeCount ?? 0,
          price:     item.price ?? 0,
          url:       `https://note.com/${username}/n/${item.key}`,
          publishAt: item.publishAt ?? null,
        });
      }
      if (items.length < 20) break;
      page++;
    } catch (err) {
      logger.warn(MODULE, `public API error for ${username} p${page}: ${err.message}`);
      break;
    }
  }
  return articles;
}

// ── Playwright でダッシュボード PV 取得 ──────────────────────────

async function fetchDashboardStats(username, chromeProfile) {
  const pvMap = {};
  let context;
  try {
    context = await launchChromeProfileContext(chromeProfile);
    const page = await context.newPage();

    const statsUrl = `https://note.com/${username}/stats`;
    await page.goto(statsUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // ログインページにリダイレクトされた場合はスキップ
    if (page.url().includes('/login')) {
      logger.warn(MODULE, `${username}: not logged in for stats`);
      return pvMap;
    }

    // 記事別PV行を収集
    // note の stats ページ構造: /stats にアクセスすると記事別PVテーブルが表示される
    const rows = await page.locator('tr, [class*="StatsNote"], [class*="stats-note"]').all();
    for (const row of rows) {
      try {
        const link = row.locator('a[href*="/n/"]').first();
        const href = await link.getAttribute('href').catch(() => null);
        if (!href) continue;
        const m = href.match(/\/n\/([a-z0-9]+)/);
        if (!m) continue;
        const key = m[1];

        // PV数: 数値テキストを探す
        const cells = await row.locator('td, [class*="count"], [class*="pv"]').all();
        for (const cell of cells) {
          const txt = (await cell.textContent().catch(() => '')).replace(/,/g, '').trim();
          const n = parseInt(txt);
          if (!isNaN(n) && n > 0) {
            pvMap[key] = (pvMap[key] ?? 0) + n;
            break;
          }
        }
      } catch { /* skip row */ }
    }

    logger.info(MODULE, `${username}: ${Object.keys(pvMap).length} PV entries from dashboard`);
    return pvMap;
  } catch (err) {
    logger.warn(MODULE, `dashboard scrape failed for ${username}: ${err.message}`);
    return pvMap;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// ── メイン ────────────────────────────────────────────────────────

export async function collectNoteStats() {
  const results = [];

  for (const acct of ACCOUNTS) {
    logger.info(MODULE, `collecting ${acct.username}`);

    const articles = await fetchPublicStats(acct.username);
    const pvMap    = await fetchDashboardStats(acct.username, acct.chromeProfile);

    // PV をマージ
    const merged = articles.map(a => ({
      ...a,
      views: pvMap[a.key] ?? null,
    }));

    const totalLikes = merged.reduce((s, a) => s + a.likeCount, 0);
    const totalViews = merged.reduce((s, a) => s + (a.views ?? 0), 0);
    const paidCount  = merged.filter(a => a.price > 0).length;

    results.push({
      accountId: acct.id,
      username:  acct.username,
      articleCount: merged.length,
      totalLikes,
      totalViews,
      paidCount,
      top5: [...merged]
        .sort((a, b) => (b.views ?? b.likeCount) - (a.views ?? a.likeCount))
        .slice(0, 5)
        .map(a => ({ title: a.title?.slice(0, 40), likes: a.likeCount, views: a.views, url: a.url })),
    });
  }

  const summary = {
    updatedAt:    new Date().toISOString(),
    totalLikes:   results.reduce((s, r) => s + r.totalLikes, 0),
    totalViews:   results.reduce((s, r) => s + r.totalViews, 0),
    totalArticles: results.reduce((s, r) => s + r.articleCount, 0),
    accounts:     results,
  };

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  saveJSON(path.join(REPORTS_DIR, 'note-summary.json'), summary);
  logger.info(MODULE, `saved note-summary.json — ${summary.totalArticles} articles, ${summary.totalLikes} likes, ${summary.totalViews} views`);
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  collectNoteStats().catch(err => {
    logger.error(MODULE, err.message);
    process.exit(1);
  });
}
