/**
 * X 投稿パイプライン
 *
 * フロー: research → main queue → generate → validate → review → post
 *
 * review層:
 *   MODE=dev  → 生成結果を表示して終了（投稿しない）
 *   MODE=prod → AI自動レビュー通過後に投稿
 *
 * エクスポート:
 *   validateTweet / reviewTweet / postTweet は note-promo.js でも使用
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { FileQueue, processWithRetry } from '../shared/queue.js';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { canPost } from '../shared/daily-limit.js';
import { logXPost } from '../analytics/logger.js';
import { runResearch } from './research.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:pipeline';

// ── キュー ─────────────────────────────────────────────────────────
const mainQ   = new FileQueue(path.join(__dirname, 'queue/main.jsonl'));
const retryQ  = new FileQueue(path.join(__dirname, 'queue/retry.jsonl'));
const failedQ = new FileQueue(path.join(__dirname, 'queue/failed.jsonl'));

// 投稿済みツイートの記録ファイル（重複チェック用）
const POSTED_LOG = path.join(__dirname, 'queue/posted.jsonl');
const POSTED_KEEP_DAYS = 30; // 直近30日分を保持

// ── ルールベース検証 ────────────────────────────────────────────────
const BANNED_WORDS = ['詐欺', '絶対儲かる', '100%成功', '必ず稼げる'];

// X の実際の上限は280文字だが、URLや画像などの付加要素を考慮して保守的に設定
const MAX_TWEET_LENGTH = 140;

export function validateTweet(text) {
  if (!text || text.trim().length === 0) return { ok: false, reason: 'empty' };
  if (text.length > MAX_TWEET_LENGTH)    return { ok: false, reason: 'too long' };
  const hit = BANNED_WORDS.find(w => text.includes(w));
  if (hit)                               return { ok: false, reason: `banned: ${hit}` };
  return { ok: true };
}

// ── 重複チェック ─────────────────────────────────────────────────────
function loadRecentPosted() {
  if (!fs.existsSync(POSTED_LOG)) return [];
  const cutoff = Date.now() - POSTED_KEEP_DAYS * 24 * 60 * 60 * 1000;
  return fs.readFileSync(POSTED_LOG, 'utf8')
    .split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(item => item && item.postedAt > cutoff);
}

function recordPosted(text) {
  const entry = JSON.stringify({ text, postedAt: Date.now() });
  fs.appendFileSync(POSTED_LOG, entry + '\n');
}

export function isDuplicate(text) {
  const recent = loadRecentPosted();
  // 完全一致、またはキーワード70%以上の重複を検出
  return recent.some(item => {
    if (item.text === text) return true;
    const wordsA = new Set(text.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(w => w.length > 1));
    const wordsB = new Set(item.text.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(w => w.length > 1));
    if (wordsA.size === 0) return false;
    const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
    return overlap / wordsA.size >= 0.7;
  });
}

// ── AI レビュー ─────────────────────────────────────────────────────
const REVIEW_SYSTEM = `あなたはSNS品質レビュアーです。
以下のツイートを評価し、JSONのみで返してください。
{"ok": true/false, "reason": "判断理由（20文字以内）"}
NGの条件: 誤情報の可能性 / 不快な表現 / 140文字超過 / 無関係な内容`;

export async function reviewTweet(text) {
  const raw = await generate(REVIEW_SYSTEM, `ツイート:\n${text}`, { maxTokens: 128 });
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return { ok: false, reason: 'invalid format' };
  try {
    return JSON.parse(match[0]);
  } catch {
    return { ok: false, reason: 'review parse error' };
  }
}

// ── 投稿 ────────────────────────────────────────────────────────────
export async function postTweet(text) {
  const raw = execFileSync('xurl', ['post', text], { encoding: 'utf8' });
  const result = JSON.parse(raw);
  return result?.data?.id ?? result?.id;
}

// ── ツイート生成 ────────────────────────────────────────────────────
const TWEET_SYSTEM = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
以下のルールでツイートを1件作成してください：
- 140文字以内（日本語）
- 学びになる具体的な情報を含める
- ハッシュタグは2〜3個
- 宣伝・誇張・煽りは禁止
- 末尾に改行なし`;

async function generateTweet(item) {
  const prompt = `キーワード: ${item.keyword}\n参考ツイート: ${item.text ?? ''}`;
  return generate(TWEET_SYSTEM, prompt, { maxTokens: 300 });
}

// ── 公開 API ────────────────────────────────────────────────────────

/** Step1: リサーチしてキューに積む */
export async function enqueue(keywords) {
  await runResearch(keywords);
  logger.info(MODULE, `enqueue done. queue size: ${mainQ.size()}`);
}

/** Step2: キューから1件処理 */
export async function processQueue(opts = {}) {
  const isDev = (opts.mode ?? process.env.MODE ?? 'dev') === 'dev';

  const result = await processWithRetry(mainQ, retryQ, failedQ, async (item) => {
    const tweetText = await generateTweet(item);
    logger.info(MODULE, 'generated', {
      text: tweetText,
      keyword: item.keyword,
      attempts: item._attempts ?? 0,
    });

    const validation = validateTweet(tweetText);
    if (!validation.ok) {
      logger.warn(MODULE, `validate NG: ${validation.reason}`, { text: tweetText });
      throw new Error(`validate NG: ${validation.reason}`);
    }

    if (isDuplicate(tweetText)) {
      logger.warn(MODULE, 'duplicate tweet detected, skipping', { text: tweetText });
      return;
    }

    if (isDev) {
      console.log('\n--- DEV MODE: REVIEW REQUIRED BEFORE POSTING ---');
      console.log(tweetText);
      console.log('------------------------------------------------\n');
      return;
    }

    if (!canPost()) {
      logger.warn(MODULE, 'daily limit reached (max 5/day)');
      return;
    }

    const review = await reviewTweet(tweetText);
    if (!review.ok) {
      logger.warn(MODULE, `review NG: ${review.reason}`, { text: tweetText });
      throw new Error(`review NG: ${review.reason}`);
    }

    const tweetId = await postTweet(tweetText);
    logger.info(MODULE, `posted: ${tweetId}`);
    recordPosted(tweetText);

    logXPost({
      tweetId,
      text: tweetText,
      keyword: item.keyword,
      type: 'normal',
      sourceTheme: item.keyword,
    });
  });

  if (!result) {
    logger.info(MODULE, 'queue empty, nothing to process');
  } else if (result && !result.ok) {
    logger.warn(MODULE, `processing failed: ${result.err?.message}`, {
      attempts: result.attempts,
    });
  }

  return result;
}
