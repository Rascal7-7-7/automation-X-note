/**
 * X いいねモジュール（xurl版）
 * - xurl search でキーワード検索（Playwright不要）
 * - スコア閾値を超えたツイートにいいね
 * - 重複いいね防止のため処理済みIDを記録
 *
 * ⚠️ X の利用規約の範囲内で、自分のアカウントへの操作のみ行うこと
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { logger } from '../shared/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:like';
const LIKED_LOG = path.join(__dirname, 'queue/liked.json');

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

function xurlSearch(keyword, count = 10) {
  try {
    const raw = execFileSync(
      'xurl', ['search', keyword, '-n', String(count)],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(raw);
    // credits不足などのエラーレスポンスを検出
    if (parsed.title === 'CreditsDepleted' || parsed.type?.includes('problems')) {
      logger.warn(MODULE, `xurl search credits error: ${parsed.detail}`);
      return [];
    }
    return parsed?.data ?? [];
  } catch (err) {
    logger.warn(MODULE, `xurl search failed for "${keyword}": ${err.message}`);
    return [];
  }
}

function xurlLike(tweetId) {
  const raw = execFileSync('xurl', ['like', tweetId], { encoding: 'utf8' });
  return JSON.parse(raw);
}

export async function runLike(keywords, opts = {}) {
  const scoreThreshold = opts.scoreThreshold ?? 5;
  const maxPerRun      = opts.maxPerRun ?? 5;

  const liked = loadLiked();
  let count = 0;

  for (const keyword of keywords) {
    if (count >= maxPerRun) break;

    logger.info(MODULE, `searching for likes: "${keyword}"`);
    const tweets = xurlSearch(keyword, 10);

    for (const tweet of tweets) {
      if (count >= maxPerRun) break;

      const tweetId = tweet.id;
      if (!tweetId || liked.has(tweetId)) continue;

      const m = tweet.public_metrics ?? {};
      const score = (m.like_count ?? 0) + (m.retweet_count ?? 0) * 2;
      if (score < scoreThreshold) continue;

      try {
        xurlLike(tweetId);
        liked.add(tweetId);
        count++;
        logger.info(MODULE, `liked tweet ${tweetId} (score:${score})`);
      } catch (err) {
        logger.warn(MODULE, `like failed for ${tweetId}: ${err.message}`);
      }
    }
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
