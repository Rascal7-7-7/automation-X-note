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
import { generateWithReview } from '../shared/multi-persona-reviewer.js';
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
const MAX_TWEET_LENGTH = 270;

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

// ── xurl 可用性キャッシュ ────────────────────────────────────────────
let _xurlAvailable = null;
function isXurlAvailable() {
  if (_xurlAvailable === null) {
    try {
      execFileSync('xurl', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
      _xurlAvailable = true;
    } catch {
      _xurlAvailable = false;
    }
  }
  return _xurlAvailable;
}

function makeTwitterClient() {
  return import('twitter-api-v2').then(({ TwitterApi }) => new TwitterApi({
    appKey:      process.env.X_API_KEY,
    appSecret:   process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  }));
}

// ── 投稿 ────────────────────────────────────────────────────────────
export async function postTweet(text) {
  if (isXurlAvailable()) {
    const raw = execFileSync('xurl', ['post', text], { encoding: 'utf8' });
    const result = JSON.parse(raw);
    return result?.data?.id ?? result?.id;
  }
  logger.info(MODULE, 'xurl not available, using twitter-api-v2');
  try {
    const client = await makeTwitterClient();
    const tweet  = await client.v2.tweet(text);
    return tweet.data.id;
  } catch (apiErr) {
    logger.warn(MODULE, `twitter-api-v2 failed (${apiErr.message}), falling back to browser`);
    const { postTweetBrowser } = await import('./post-browser.js');
    return postTweetBrowser(text);
  }
}

// ── ツイート生成 ────────────────────────────────────────────────────
const TWEET_SYSTEM = `あなたはAI活用・副業・自動化をテーマに発信するXアカウントの中の人です。
以下のルールで日本語ツイートを1件作成してください。

【N=1ペルソナ（この1人に届ける）】
「AIに興味はあるが何から始めるか分からない30代会社員。月3〜5万の副収入を探している。ChatGPTは使ったことがある程度。」
この1人が「保存したい・RTしたい・試してみたい」と感じる内容を書く。

【必須ルール】
- **合計270文字以内（厳守）— 超えたら必ず削ること**
- 改行を6〜9回使う（エンゲージ率最大化）
- 1行20〜30文字以内
- URLを本文に入れない
- ハッシュタグ最大3個・末尾のみ（4個以上でシャドウバントリガー）
- 一行だけの投稿は絶対禁止
- 「〜について書きます」「今日は〜です」等の導入禁止

【冒頭1行（スクロール停止）— 絵文字を入れない】
・数字+成果: 「月3万円稼ぐAI副業を3ステップで始めた」
・意外性: 「9割のAI副業が稼げない本当の理由」
・保存型: 「保存版｜Claude Code副業チェックリスト」
・ターゲット刺し: 「副業を始めたいのに一歩踏み出せない人へ」

【テンプレート — 内容に合わせて1つ選ぶ】

▼ リスト型（最頻出）
[フック1行]

① [ポイント1]
② [ポイント2]
③ [ポイント3]
④ [ポイント4]
⑤ [ポイント5]

[まとめ1行]
保存して後で見返してね📌

▼ 保存版チェックリスト型
━━━━━━━━━━━━
🔖 保存版｜[テーマ]チェックリスト
━━━━━━━━━━━━

✅ [項目1]
✅ [項目2]
✅ [項目3]
✅ [項目4]
✅ [項目5]

全部できてる人は[結果]が出てるはず💪

▼ Before/After型
[状態]だった私が[成果]になれた理由

❌ Before：[具体的な悩み]
✅ After：[具体的な成果]

変えたのはたった[一つのこと]だけ。
[補足1行]

同じ悩みの人に届いてほしい🙏

▼ 試した結果型
[N個の〇〇]を試した結果を正直に話す

[対象1]→[一言評価]
[対象2]→[一言評価]
[対象3]→[一言評価]

結論：[本命]だけで十分。
時間とお金の無駄をなくしてほしいから言う。

【末尾CTA（必須・どれか1つ）】
「[条件]の人はリプで教えて👇」「ブクマ推奨📌」「役立ったらRTしてくれると嬉しいです」

【禁止】
一行だけ/改行なし/「今日は〇〇について書きます」系の導入/ハッシュタグ4個以上/宣伝・誇張`;

function cleanTweetOutput(raw) {
  // Strip markdown headers, footnote blocks (--- 以降の注記), and leading/trailing whitespace
  return raw
    .replace(/^#[^\n]*\n+/gm, '')          // # ツイート案 など見出し行を除去
    .replace(/\n---[\s\S]*$/s, '')          // --- 以降の注記ブロックを除去
    .replace(/\*\*注記[：:][^*]*\*\*/gs, '') // **注記：...** インライン除去
    .trim();
}

async function generateTweet(item) {
  // x-gen source: already reviewed text — use directly, skip regeneration
  if (item.source === 'x-gen' && item.text) {
    if (item.text.length > MAX_TWEET_LENGTH) throw new Error(`too long (${item.text.length} chars)`);
    return item.text;
  }

  const { content } = await generateWithReview(
    (hint) => generate(
      TWEET_SYSTEM,
      `キーワード: ${item.keyword}\n参考ツイート: ${item.text ?? ''}${hint ? `\n\n改善指示:\n${hint}` : ''}`,
      { maxTokens: 300 }
    ).then(raw => {
      const cleaned = cleanTweetOutput(raw);
      if (cleaned.length > MAX_TWEET_LENGTH) {
        throw new Error(`too long (${cleaned.length} chars) — 270文字以内に収めること`);
      }
      return cleaned;
    }),
    'X', 'x-general'
  );
  return content;
}

// ── リプライ投稿 ─────────────────────────────────────────────────────
export async function postReply(text, replyToId) {
  if (isXurlAvailable()) {
    const raw = execFileSync('xurl', ['reply', replyToId, text], { encoding: 'utf8' });
    const result = JSON.parse(raw);
    return result?.data?.id ?? result?.id;
  }
  logger.info(MODULE, 'xurl not available, using twitter-api-v2 for reply');
  try {
    const client = await makeTwitterClient();
    const tweet  = await client.v2.tweet({ text, reply: { in_reply_to_tweet_id: replyToId } });
    return tweet.data.id;
  } catch (apiErr) {
    logger.warn(MODULE, `twitter-api-v2 reply failed (${apiErr.message}), skipping reply`);
    throw apiErr;
  }
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
