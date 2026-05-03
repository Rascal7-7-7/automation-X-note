/**
 * note クロスいいね — 3アカウント間で互いの公開記事にいいねする
 *
 * 重複防止: note/queue/cross-liked.jsonl に {noteUrl, likedBy, likedAt} を記録
 * 使い方:   node note/cross-like.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:cross-like';

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

const QUEUE_FILE = path.join(__dirname, 'queue/cross-liked.jsonl');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── セッション ──────────────────────────────────────────────────────

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

async function getCsrfToken(cookie) {
  try {
    const res = await fetch('https://note.com/', {
      headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    const html = await res.text();
    const m = html.match(/<meta name="csrf-token" content="([^"]+)"/);
    return m ? m[1] : null;
  } catch (err) {
    logger.warn(MODULE, `getCsrfToken failed: ${err.message}`);
    return null;
  }
}

// ── 重複管理 ────────────────────────────────────────────────────────

function loadLikedSet() {
  if (!fs.existsSync(QUEUE_FILE)) return new Set();
  const lines = fs.readFileSync(QUEUE_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const set = new Set();
  for (const line of lines) {
    try {
      const { noteUrl, likedBy } = JSON.parse(line);
      if (noteUrl && likedBy) set.add(`${noteUrl}::${likedBy}`);
    } catch { /* malformed line — skip */ }
  }
  return set;
}

function appendLiked(noteUrl, likedBy) {
  const entry = JSON.stringify({ noteUrl, likedBy, likedAt: new Date().toISOString() }) + '\n';
  try {
    fs.appendFileSync(QUEUE_FILE, entry);
  } catch (err) {
    // In-memory likedSet still valid for this run; log but don't throw
    logger.error(MODULE, `appendLiked write failed: ${err.message} — dedup state at risk`);
  }
}

// ── note 公開 API ────────────────────────────────────────────────────

async function fetchArticles(username) {
  const articles = [];
  let page = 1;
  while (page <= 5) {
    const url = `https://note.com/api/v2/creators/${username}/contents?kind=note&page=${page}&per=20`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) break;
      const data = await res.json();
      const items = data?.data?.contents ?? [];
      if (items.length === 0) break;
      for (const item of items) {
        if (typeof item.id !== 'number' || !item.id) {
          logger.warn(MODULE, `fetchArticles: skipping item with no numeric id for ${username}`);
          continue;
        }
        if (!item.key || !/^[a-zA-Z0-9_-]+$/.test(item.key)) {
          logger.warn(MODULE, `fetchArticles: invalid key "${item.key}" for ${username} — skipping`);
          continue;
        }
        articles.push({
          id:  item.id,
          key: item.key,
          url: `https://note.com/${username}/n/${item.key}`,
        });
      }
      if (items.length < 20) break;
      page++;
    } catch (err) {
      logger.warn(MODULE, `fetchArticles error ${username} p${page}: ${err.message}`);
      break;
    }
  }
  return articles;
}

// ── いいね API ───────────────────────────────────────────────────────
// Returns: 'ok' | 'already' | 'auth_error' | 'csrf_error' | 'error'

async function likeArticle(cookie, csrfToken, article, likerUsername) {
  const headers = {
    Cookie:             cookie,
    'Content-Type':     'application/json',
    'User-Agent':       UA,
    Accept:             'application/json',
    Referer:            article.url,
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  try {
    const res = await fetch('https://note.com/api/v1/likes', {
      method:  'POST',
      headers,
      body:    JSON.stringify({ target_id: article.id, target_type: 'Note' }),
      signal:  AbortSignal.timeout(10_000),
    });

    if (res.status === 200 || res.status === 201) return 'ok';
    if (res.status === 409) return 'already';
    if (res.status === 401 || res.status === 403) return 'auth_error';
    if (res.status === 422) return 'csrf_error';

    const errBody = (await res.text().catch(() => '')).slice(0, 200);
    logger.warn(MODULE, `like failed ${article.id} by ${likerUsername}: HTTP ${res.status} — ${errBody}`);
    return 'error';
  } catch (err) {
    logger.warn(MODULE, `like error ${article.id} by ${likerUsername}: ${err.message}`);
    return 'error';
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── メイン ───────────────────────────────────────────────────────────

export async function runCrossLike() {
  const queueDir = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });

  const likedSet = loadLikedSet();

  // 全アカウントの記事を取得
  const articlesByAccount = {};
  for (const acct of ACCOUNTS) {
    articlesByAccount[acct.id] = await fetchArticles(acct.username);
    logger.info(MODULE, `${acct.username}: ${articlesByAccount[acct.id].length} articles`);
  }

  let likeCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  // acct1→acct2/acct3、acct2→acct1/acct3、acct3→acct1/acct2 でいいね
  for (const liker of ACCOUNTS) {
    const cookie = loadSessionCookie(liker.id);
    if (!cookie) {
      logger.warn(MODULE, `no session for acct${liker.id} (${liker.username}) — skipping`);
      continue;
    }

    let csrfToken = await getCsrfToken(cookie);
    if (!csrfToken) {
      logger.warn(MODULE, `no CSRF token for acct${liker.id} — will try without`);
    }

    let authFailed = false;
    const targets = ACCOUNTS.filter(a => a.id !== liker.id);

    outer: for (const target of targets) {
      for (const article of articlesByAccount[target.id]) {
        if (authFailed) break outer;

        const dedupKey = `${article.url}::acct${liker.id}`;
        if (likedSet.has(dedupKey)) {
          skipCount++;
          continue;
        }

        let result = await likeArticle(cookie, csrfToken, article, liker.username);

        // 422 = CSRF stale — re-fetch token and retry once
        if (result === 'csrf_error') {
          logger.warn(MODULE, `CSRF error for acct${liker.id} — refreshing token`);
          csrfToken = await getCsrfToken(cookie);
          if (!csrfToken) {
            logger.error(MODULE, `cannot refresh CSRF for acct${liker.id} — aborting liker`);
            authFailed = true;
            errorCount++;
            break outer;
          }
          result = await likeArticle(cookie, csrfToken, article, liker.username);
        }

        if (result === 'auth_error') {
          logger.error(MODULE, `session expired for acct${liker.id} (${liker.username}) — aborting this liker. Run: node note/save-session.js`);
          authFailed = true;
          errorCount++;
          break outer;
        }

        if (result === 'ok') {
          appendLiked(article.url, `acct${liker.id}`);
          likedSet.add(dedupKey);
          likeCount++;
          logger.info(MODULE, `liked: ${article.url} by acct${liker.id}`);
        } else if (result === 'already') {
          appendLiked(article.url, `acct${liker.id}`);
          likedSet.add(dedupKey);
          skipCount++;
        } else {
          errorCount++;
        }

        // 2〜4秒ランダム遅延（レート制限回避）
        await sleep(2_000 + Math.random() * 2_000);
      }
    }
  }

  logger.info(MODULE, `done. liked=${likeCount} skipped=${skipCount} errors=${errorCount}`);
  return { likeCount, skipCount, errorCount };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCrossLike().catch(err => {
    logger.error(MODULE, err.message);
    process.exit(1);
  });
}
