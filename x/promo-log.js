/**
 * x/queue/note-promo-log.jsonl の読み書きヘルパー
 * 形式: {tweetId, noteUrl, title, account, postedAt, repromoDone?, repromoPostedAt?}
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROMO_LOG_FILE = path.join(__dirname, 'queue/note-promo-log.jsonl');

export function loadPromoLog() {
  if (!fs.existsSync(PROMO_LOG_FILE)) return [];
  return fs.readFileSync(PROMO_LOG_FILE, 'utf8')
    .trim().split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

export function appendPromoLog(entry) {
  const dir = path.dirname(PROMO_LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(PROMO_LOG_FILE, JSON.stringify(entry) + '\n');
}

/** 指定 tweetId のエントリを fields でマージして全行を書き直す */
export function updatePromoLogEntry(tweetId, fields) {
  const entries = loadPromoLog();
  let matched = false;
  const updated = entries.map(e => {
    if (e.tweetId !== tweetId) return e;
    matched = true;
    return { ...e, ...fields };
  });
  if (!matched) throw new Error(`updatePromoLogEntry: tweetId not found: ${tweetId}`);
  fs.writeFileSync(PROMO_LOG_FILE, updated.map(e => JSON.stringify(e)).join('\n') + '\n');
}
