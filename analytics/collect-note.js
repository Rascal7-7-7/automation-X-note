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
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'analytics:note';
const REPORTS_DIR = path.join(__dirname, 'reports');

const SESSION_FILES = {
  1: path.join(__dirname, '../.note-session.json'),
  2: path.join(__dirname, '../.note-session-2.json'),
  3: path.join(__dirname, '../.note-session-3.json'),
};

const ACCOUNTS = [
  { id: 1, username: 'rascal_ai_devops' },
  { id: 2, username: 'rascal_invest' },
  { id: 3, username: 'rascal_affiliate' },
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

// ── note API で記事別PV取得 ──────────────────────────────────────
// GET /api/v1/stats/pv?filter=<all|daily|weekly|monthly>&page=N
// レスポンス: data.note_stats[].key, data.note_stats[].read_count
// 認証: _note_session_v5 cookie 必須

function loadSessionCookie(accountId) {
  const file = SESSION_FILES[accountId];
  if (!file || !fs.existsSync(file)) return null;
  try {
    const { cookies } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const session = cookies?.find(c => c.name === '_note_session_v5' && c.domain.includes('note.com'));
    return session ? `_note_session_v5=${session.value}` : null;
  } catch (err) {
    logger.warn(MODULE, `loadSessionCookie failed for account${accountId}: ${err.message}`);
    return null;
  }
}

async function fetchPVStats(accountId, username, filter = 'monthly') {
  const cookie = loadSessionCookie(accountId);
  if (!cookie) {
    logger.warn(MODULE, `${username}: no session cookie — run: node note/save-session.js`);
    return {};
  }

  const pvMap = {};
  let page = 1;
  while (true) {
    const url = `https://note.com/api/v1/stats/pv?filter=${filter}&page=${page}`;
    try {
      const res = await fetch(url, {
        headers: {
          Cookie:     cookie,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept:     'application/json',
          Referer:    'https://note.com/',
        },
      });
      if (!res.ok) {
        const errBody = (await res.text().catch(() => '')).slice(0, 200);
        logger.warn(MODULE, `${username}: stats/pv ${res.status} — ${errBody}`);
        break;
      }
      const data = (await res.json())?.data;
      for (const item of data?.note_stats ?? []) {
        if (item.key && item.read_count != null) {
          pvMap[item.key] = item.read_count;
        }
      }
      if (!data || data.last_page) break;
      page++;
    } catch (err) {
      logger.warn(MODULE, `${username}: stats/pv fetch error p${page}: ${err.message}`);
      break;
    }
  }

  logger.info(MODULE, `${username}: ${Object.keys(pvMap).length} PV entries (filter=${filter})`);
  return pvMap;
}

// ── メイン ────────────────────────────────────────────────────────

export async function collectNoteStats() {
  const results = [];

  for (const acct of ACCOUNTS) {
    logger.info(MODULE, `collecting ${acct.username}`);

    const articles = await fetchPublicStats(acct.username);
    const pvMap    = await fetchPVStats(acct.id, acct.username);

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
