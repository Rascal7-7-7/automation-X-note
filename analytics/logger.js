/**
 * アナリティクスロガー
 * 3系統の JSONL ファイルに追記する。
 *
 * logs/analytics/
 *   x-posts.jsonl       X投稿ログ
 *   note-posts.jsonl    note記事ログ
 *   performance.jsonl   パフォーマンス数値ログ
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '../../logs/analytics');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function appendLine(file, record) {
  fs.appendFileSync(
    path.join(LOGS_DIR, file),
    JSON.stringify(record) + '\n',
  );
}

// ── X投稿ログ ─────────────────────────────────────────────────────────
/**
 * @param {{
 *   tweetId: string,
 *   text: string,
 *   keyword?: string,
 *   type: 'normal' | 'promo',
 *   sourceTheme?: string,
 *   noteUrl?: string,
 * }} data
 */
export function logXPost(data) {
  appendLine('x-posts.jsonl', {
    ...data,
    status: 'posted',
    createdAt: new Date().toISOString(),
  });
}

// ── note記事ログ ──────────────────────────────────────────────────────
/**
 * @param {{
 *   title: string,
 *   theme: string,
 *   summary: string,
 *   draftPath: string,
 *   imagePath?: string,
 * }} data
 */
export function logNoteDraft(data) {
  appendLine('note-posts.jsonl', {
    ...data,
    noteUrl: null,
    postedAt: null,
    status: 'draft',
    createdAt: new Date().toISOString(),
  });
}

/**
 * @param {string} draftPath
 * @param {string} noteUrl
 */
export function logNotePosted(draftPath, noteUrl) {
  appendLine('note-posts.jsonl', {
    draftPath,
    noteUrl,
    status: 'posted',
    postedAt: new Date().toISOString(),
  });
}

// ── パフォーマンスログ ─────────────────────────────────────────────────
/**
 * @param {{
 *   targetType: 'x' | 'note',
 *   targetId: string,
 *   likes?: number,
 *   reposts?: number,
 *   replies?: number,
 *   impressions?: number,
 *   clicks?: number,
 * }} data
 */
export function logPerformance(data) {
  appendLine('performance.jsonl', {
    ...data,
    fetchedAt: new Date().toISOString(),
  });
}

// ── 読み取りユーティリティ ─────────────────────────────────────────────
export function readLog(file) {
  const filePath = path.join(LOGS_DIR, file);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}
