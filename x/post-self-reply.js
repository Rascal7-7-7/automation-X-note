/**
 * 投稿後 2時間 遅延 self-reply キュー
 *
 * - scheduleSelfReply(tweetId, templateKey) — pending-self-replies.jsonl に追記
 * - runPendingSelfReplies()                 — 期限到来分をポストして完了記録
 *
 * x:post-self-reply cron (毎30分) が呼び出す。
 * x:article 投稿成功時に scheduleSelfReply('article') を呼ぶ。
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR    = path.join(__dirname, 'queue');
const PENDING_FILE = path.join(QUEUE_DIR, 'pending-self-replies.jsonl');
const DONE_FILE    = path.join(QUEUE_DIR, 'done-self-replies.jsonl');

fs.mkdirSync(QUEUE_DIR, { recursive: true });
const MODULE       = 'x:post-self-reply';
const DELAY_MS     = 2 * 60 * 60 * 1000; // 2時間
const MAX_AGE_MS   = 24 * 60 * 60 * 1000; // 失敗エントリの破棄上限

const TEMPLATES = {
  article: 'AIコスト約3〜5円/回、作業時間は5分以内でした。自動化の仕組みをnoteで公開中 → note.com/rascal_ai_devops',
  'x-article': '補足: この記事はClaude AIが全自動生成しました。月コストは3〜5円/記事。詳しくはnoteに書いてます → note.com/rascal_ai_devops',
};

// ── キューI/O ─────────────────────────────────────────────────────

function readPending() {
  if (!fs.existsSync(PENDING_FILE)) return [];
  return fs.readFileSync(PENDING_FILE, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function writePending(entries) {
  const body = entries.length ? entries.map(e => JSON.stringify(e)).join('\n') + '\n' : '';
  const tmp = PENDING_FILE + '.tmp';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, PENDING_FILE);
}

function appendDone(entry) {
  fs.appendFileSync(
    DONE_FILE,
    JSON.stringify({ ...entry, doneAt: new Date().toISOString() }) + '\n',
  );
}

// ── xurl / twitter-api-v2 でリプライ投稿 ─────────────────────────

let _xurlAvailable = null;
function isXurlAvailable() {
  if (_xurlAvailable === null) {
    try {
      execFileSync('xurl', ['--version'], { stdio: 'pipe' });
      _xurlAvailable = true;
    } catch { _xurlAvailable = false; }
  }
  return _xurlAvailable;
}

async function postSelfReply(tweetId, text) {
  if (isXurlAvailable()) {
    const raw = execFileSync('xurl', ['reply', tweetId, text], {
      encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
    });
    return JSON.parse(raw);
  }

  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey:       process.env.X_API_KEY,
    appSecret:    process.env.X_API_SECRET,
    accessToken:  process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
  return client.v2.tweet(text, { reply: { in_reply_to_tweet_id: tweetId } });
}

// ── 公開API ───────────────────────────────────────────────────────

/**
 * self-reply をキューに追加する。投稿成功後すぐに呼ぶこと。
 * @param {string} tweetId    対象ツイートID（スレッド先頭）
 * @param {string} templateKey TEMPLATES のキー ('article' | 'x-article')
 */
export function scheduleSelfReply(tweetId, templateKey = 'article') {
  const entry = {
    tweetId,
    templateKey,
    executeAt:   new Date(Date.now() + DELAY_MS).toISOString(),
    scheduledAt: new Date().toISOString(),
  };
  fs.appendFileSync(PENDING_FILE, JSON.stringify(entry) + '\n');
  logger.info(MODULE, `queued self-reply for ${tweetId} at ${entry.executeAt}`);
}

/**
 * 期限到来の pending エントリを投稿する。
 * cron `*\/30 * * * *` から呼ぶ。
 */
export async function runPendingSelfReplies() {
  const pending = readPending();
  if (pending.length === 0) {
    logger.info(MODULE, 'no pending self-replies');
    return;
  }

  const now = Date.now();
  const due    = pending.filter(e => new Date(e.executeAt).getTime() <= now);
  const notDue = pending.filter(e => new Date(e.executeAt).getTime() > now);

  if (due.length === 0) {
    logger.info(MODULE, `${pending.length} pending, none due yet (next: ${pending[0].executeAt})`);
    return;
  }

  logger.info(MODULE, `processing ${due.length} due self-replies`);

  const failed = [];
  for (const entry of due) {
    const text = TEMPLATES[entry.templateKey] ?? TEMPLATES.article;
    try {
      await postSelfReply(entry.tweetId, text);
      logger.info(MODULE, `self-reply posted to tweet ${entry.tweetId}`);
      appendDone(entry);
    } catch (err) {
      logger.warn(MODULE, `failed to post self-reply to ${entry.tweetId}: ${err.message}`);
      // 24h 以内の失敗のみ再キュー（それ以降は破棄）
      const age = now - new Date(entry.scheduledAt).getTime();
      if (age < MAX_AGE_MS) {
        failed.push(entry);
      } else {
        logger.warn(MODULE, `self-reply to ${entry.tweetId} expired (>24h), discarding`);
      }
    }
  }

  writePending([...notDue, ...failed]);
  logger.info(MODULE, `done. posted: ${due.length - failed.length}, re-queued: ${failed.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPendingSelfReplies();
}
