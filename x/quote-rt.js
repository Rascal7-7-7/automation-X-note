/**
 * X Quote Retweet Module
 * - Finds viral AI/tech tweets worth amplifying
 * - Generates insightful Japanese commentary (own perspective)
 * - Posts as quote retweet
 * - Daily limit: 3 quote RTs/day
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
const MODULE = 'x:quote-rt';

const QUOTED_LOG = path.join(__dirname, 'queue/quoted.jsonl');
const DAILY_MAX  = 3;

const QUOTE_SYSTEM = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
以下のルールで引用RTのコメントを1件作成してください：
- 80〜120文字（日本語）
- 自分なりの視点・解釈・補足情報を加える（単なる称賛は禁止）
- 読者が「なるほど」と思える独自の洞察を含める
- 宣伝・URL・自己PRは含めない
- ハッシュタグは1〜2個まで（なくてもよい）
- 末尾に改行なし`;

// ── 引用済み管理 ───────────────────────────────────────────────────

function loadQuoted() {
  if (!fs.existsSync(QUOTED_LOG)) return { ids: new Set(), todayCount: 0 };
  const today = new Date().toDateString();
  let todayCount = 0;
  const ids = new Set();

  const lines = fs.readFileSync(QUOTED_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      ids.add(entry.tweetId);
      if (entry.quotedAt && new Date(entry.quotedAt).toDateString() === today) {
        todayCount++;
      }
    } catch { /* skip corrupt lines */ }
  }

  return { ids, todayCount };
}

function recordQuoted(tweetId, commentary, quoteTweetId) {
  const entry = JSON.stringify({
    tweetId,
    commentary,
    quoteTweetId,
    quotedAt: new Date().toISOString(),
  });
  appendFileSync(QUOTED_LOG, entry + '\n');
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

function xurlQuoteRT(tweetId, commentary) {
  const raw = execFileSync('xurl', ['quote', tweetId, commentary], { encoding: 'utf8' });
  return JSON.parse(raw);
}

// ── コメント生成 ──────────────────────────────────────────────────

async function generateCommentary(tweetText) {
  const prompt = `以下のツイートを引用RTする際のコメントを1件作成してください。\nツイート: ${tweetText}`;
  return generate(QUOTE_SYSTEM, prompt, { maxTokens: 250 });
}

// ── メイン ────────────────────────────────────────────────────────

export async function runQuoteRT(keywords, opts = {}) {
  const scoreThreshold = opts.scoreThreshold ?? 20;
  const maxPerRun      = opts.maxPerRun ?? DAILY_MAX;

  const { ids: quotedIds, todayCount } = loadQuoted();

  if (todayCount >= DAILY_MAX) {
    logger.info(MODULE, `daily limit reached (${DAILY_MAX}/day), skipping`);
    return;
  }

  const remaining = Math.min(maxPerRun, DAILY_MAX - todayCount);
  let count = 0;

  for (const keyword of keywords) {
    if (count >= remaining) break;

    logger.info(MODULE, `searching for quote-RT targets: "${keyword}"`);
    const tweets = xurlSearch(keyword, 10);

    for (const tweet of tweets) {
      if (count >= remaining) break;

      const tweetId = tweet.id;
      if (!tweetId || quotedIds.has(tweetId)) continue;

      const m = tweet.public_metrics ?? {};
      const score = (m.like_count ?? 0) + (m.retweet_count ?? 0) * 2;
      if (score < scoreThreshold) continue;

      const tweetText = tweet.text ?? '';
      if (!tweetText.trim()) continue;

      try {
        const commentary = await generateCommentary(tweetText);
        logger.info(MODULE, `generated commentary for ${tweetId}`, { commentary });

        const result = xurlQuoteRT(tweetId, commentary);
        const quoteTweetId = result?.data?.id ?? result?.id;
        recordQuoted(tweetId, commentary, quoteTweetId);
        count++;
        logger.info(MODULE, `quote-RT done. original:${tweetId} new:${quoteTweetId} (score:${score})`);
      } catch (err) {
        logger.warn(MODULE, `quote-RT failed for ${tweetId}: ${err.message}`);
      }
    }
  }

  logger.info(MODULE, `quote-RT run done. quoted: ${count}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keywords = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['AI活用', 'Claude', '生成AI', '個人開発'];

  runQuoteRT(keywords);
}
