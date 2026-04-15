/**
 * X Auto-Reply Module
 * - Searches for high-engagement tweets about AI/副業/自動化
 * - Generates thoughtful reply using Claude Haiku
 * - Posts reply via xurl CLI
 * - Prevents duplicate replies (tracks replied tweet IDs)
 * - Daily limit: 10 replies/day
 *
 * ⚠️ X の利用規約の範囲内で、自分のアカウントへの操作のみ行うこと
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { appendFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:reply';

const REPLIED_LOG = path.join(__dirname, 'queue/replied.jsonl');
const DAILY_MAX   = 10;

const REPLY_SYSTEM = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
以下のルールでリプライ文を1件作成してください：
- 50〜100文字（日本語）
- 相手のツイート内容に具体的に言及して価値を添える
- 共感・補足・別視点のいずれかで会話を発展させる
- 宣伝・自己紹介・URLは絶対に含めない
- ハッシュタグ不要
- 末尾に改行なし`;

// ── 返信済み管理 ───────────────────────────────────────────────────

function loadReplied() {
  if (!fs.existsSync(REPLIED_LOG)) return { ids: new Set(), todayCount: 0, date: '' };
  const today = new Date().toDateString();
  let todayCount = 0;
  const ids = new Set();

  const lines = fs.readFileSync(REPLIED_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      ids.add(entry.tweetId);
      if (entry.repliedAt && new Date(entry.repliedAt).toDateString() === today) {
        todayCount++;
      }
    } catch { /* skip corrupt lines */ }
  }

  return { ids, todayCount, date: today };
}

function recordReplied(tweetId, replyText) {
  const entry = JSON.stringify({
    tweetId,
    replyText,
    repliedAt: new Date().toISOString(),
  });
  appendFileSync(REPLIED_LOG, entry + '\n');
}

// ── xurl ラッパー ─────────────────────────────────────────────────

function xurlSearch(keyword, count = 10) {
  try {
    const raw = execFileSync(
      'xurl', ['search', keyword, '-n', String(count)],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(raw);
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

function xurlReply(tweetId, text) {
  const raw = execFileSync('xurl', ['reply', tweetId, text], { encoding: 'utf8' });
  return JSON.parse(raw);
}

// ── 返信文生成 ────────────────────────────────────────────────────

async function generateReply(tweetText) {
  const prompt = `以下のツイートに対するリプライを1件作成してください。\nツイート: ${tweetText}`;
  return generate(REPLY_SYSTEM, prompt, { maxTokens: 200 });
}

// ── メイン ────────────────────────────────────────────────────────

export async function runReply(keywords, opts = {}) {
  const scoreThreshold = opts.scoreThreshold ?? 5;
  const maxPerRun      = opts.maxPerRun ?? DAILY_MAX;

  const { ids: repliedIds, todayCount } = loadReplied();

  if (todayCount >= DAILY_MAX) {
    logger.info(MODULE, `daily limit reached (${DAILY_MAX}/day), skipping`);
    return;
  }

  const remaining = Math.min(maxPerRun, DAILY_MAX - todayCount);
  let count = 0;

  for (const keyword of keywords) {
    if (count >= remaining) break;

    logger.info(MODULE, `searching for reply targets: "${keyword}"`);
    const tweets = xurlSearch(keyword, 10);

    for (const tweet of tweets) {
      if (count >= remaining) break;

      const tweetId = tweet.id;
      if (!tweetId || repliedIds.has(tweetId)) continue;

      const m = tweet.public_metrics ?? {};
      const score = (m.like_count ?? 0) + (m.retweet_count ?? 0) * 2;
      if (score < scoreThreshold) continue;

      const tweetText = tweet.text ?? '';
      if (!tweetText.trim()) continue;

      try {
        const replyText = await generateReply(tweetText);
        logger.info(MODULE, `generated reply for ${tweetId}`, { replyText });

        xurlReply(tweetId, replyText);
        recordReplied(tweetId, replyText);
        count++;
        logger.info(MODULE, `replied to tweet ${tweetId} (score:${score})`);
      } catch (err) {
        logger.warn(MODULE, `reply failed for ${tweetId}: ${err.message}`);
      }
    }
  }

  logger.info(MODULE, `reply run done. replied: ${count}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keywords = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['AI活用', 'Claude', '副業', '自動化'];

  runReply(keywords);
}
