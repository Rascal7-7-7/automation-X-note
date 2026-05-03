/**
 * コバンザメ戦略 — AI副業系上位アカウントへの自動リプライ
 *
 * - ターゲットアカウントの最新ツイートを取得（Playwright）
 * - Claude Haiku でリプライ文生成（同意/補足/質問の3パターン）
 * - xurl / twitter-api-v2 でリプライ投稿
 * - 1日20件上限・重複スキップ・3〜8s インターバル（シャドウバン防止）
 *
 * スケジューラー: 09:30 + 22:30 JST
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getXBrowser } from './browser-client.js';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const TARGETS_FILE = path.join(__dirname, 'coattail-targets.json');
const REPLIED_LOG  = path.join(__dirname, 'queue/coattail-replied.jsonl');
const MODULE       = 'x:coattail-reply';

const REPLY_SYSTEM = `あなたはAI副業・自動化を発信するXアカウントの中の人です。
指定されたツイートに対して、価値あるリプライを1件生成してください。

パターン（ランダムに1つ選ぶ）:
A) 同意型: 相手の主張に共感＋自分の具体的な体験を1文で補強
B) 補足型: 相手の内容に関連する追加情報・視点を提供
C) 質問型: 相手の内容に対する率直な疑問・深掘り質問（1問のみ）

制約:
- 100文字以内
- 自然な話し言葉（です・ます体でなくていい）
- URLは含めない
- ハッシュタグは含めない
- 宣伝・営業色ゼロ
- 相手アカウントへの過度な称賛・媚び禁止（"素晴らしい"など）`;

// ── 既返信済み管理 ────────────────────────────────────────────────

function loadReplied() {
  if (!fs.existsSync(REPLIED_LOG)) return new Set();
  const ids = new Set();
  fs.readFileSync(REPLIED_LOG, 'utf8').split('\n').filter(Boolean).forEach(line => {
    try { ids.add(JSON.parse(line).tweetId); } catch { /* skip */ }
  });
  return ids;
}

function jstDateStr() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function countTodayReplied() {
  if (!fs.existsSync(REPLIED_LOG)) return 0;
  const today = jstDateStr();
  return fs.readFileSync(REPLIED_LOG, 'utf8').split('\n').filter(Boolean).reduce((n, line) => {
    try {
      const e = JSON.parse(line);
      return n + (e.repliedAt?.startsWith(today) ? 1 : 0);
    } catch { return n; }
  }, 0);
}

function recordReplied(tweetId, handle, replyText) {
  // repliedAt は JST 日付で countTodayReplied と一致させる
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
  fs.appendFileSync(
    REPLIED_LOG,
    JSON.stringify({ tweetId, handle, replyText, repliedAt: jstNow }) + '\n',
  );
}

// ── Playwright でアカウントの最新ツイートを取得 ───────────────────

async function fetchRecentTweets(page, handle, maxTweets = 1) {
  // X は href を lowercase に正規化するため selector も lowercase で照合
  const handleLower = handle.toLowerCase();
  const url = `https://x.com/${handleLower}`;
  logger.info(MODULE, `fetching tweets from @${handle}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await page.waitForTimeout(3_000);
  } catch (err) {
    logger.warn(MODULE, `page load failed @${handle}: ${err.message}`);
    return [];
  }

  const articles = await page.locator('article[data-testid="tweet"]').all();
  const tweets   = [];
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;

  for (const article of articles.slice(0, 10)) {
    if (tweets.length >= maxTweets) break;
    try {
      // RT判定: socialContext テキストに "repost" / "リポスト" が含まれる記事はスキップ
      const socialCtx = await article.locator('[data-testid="socialContext"]').first()
        .textContent().catch(() => '');
      const isRT = socialCtx.toLowerCase().includes('repost') || socialCtx.includes('リポスト');
      if (isRT) continue;

      // ツイートIDをpermalinkから取得（ターゲットアカウントのツイートのみ）
      const links = await article.locator(`a[href*="/${handleLower}/status/"]`).all();
      let tweetId = null;
      for (const link of links) {
        const href = await link.getAttribute('href');
        const m    = href?.match(/\/status\/(\d+)/);
        if (m) { tweetId = m[1]; break; }
      }
      if (!tweetId) continue;

      // ツイート時刻（time[datetime]）で6時間フィルタ
      const timeEl = article.locator('time[datetime]').first();
      const dt = await timeEl.getAttribute('datetime').catch(() => null);
      if (dt && new Date(dt).getTime() < sixHoursAgo) continue;

      // 本文取得
      const text = await article
        .locator('[data-testid="tweetText"]').first()
        .textContent().catch(() => '');

      if (text.trim()) {
        tweets.push({ tweetId, handle, text: text.trim() });
      }
    } catch { /* skip article */ }
  }

  logger.info(MODULE, `  @${handle}: ${tweets.length} original tweets (≤6h)`);
  return tweets;
}

// ── リプライ文生成 ────────────────────────────────────────────────

const REFUSAL_PATTERNS = ['申し訳', 'お断り', 'リプライ作成はお断', 'わかりました。パターン', '**生成リプラ', '生成リプライ'];

async function generateReply(tweet) {
  const patterns = ['A（同意型）', 'B（補足型）', 'C（質問型）'];
  const pattern  = patterns[Math.floor(Math.random() * patterns.length)];

  const prompt = `パターン${pattern}でリプライを作成してください。

対象ツイート: ${tweet.text.slice(0, 200)}`;

  const raw = await generate(REPLY_SYSTEM, prompt, {
    model:     'claude-haiku-4-5-20251001',
    maxTokens: 200,
  });
  const text = raw.trim().slice(0, 100);
  if (REFUSAL_PATTERNS.some(p => text.includes(p))) {
    throw new Error('claude refused to generate reply');
  }
  return text;
}

// ── Playwright でリプライ投稿（API 403 回避） ─────────────────────
// Twitter API の reply 制限（フォロワー限定設定等）を Playwright で回避する。
// ブラウザ上の「返信」ダイアログを操作するため API 権限に依存しない。

async function postCoattailReply(tweetId, text, page) {
  const tweetUrl = `https://x.com/i/status/${tweetId}`;
  await page.goto(tweetUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await page.waitForTimeout(2_000);

  // 「返信」ボタンをクリック
  const replyBtn = page.locator(`[data-testid="reply"]`).first();
  await replyBtn.waitFor({ timeout: 10_000 });
  await replyBtn.click();
  await page.waitForTimeout(1_000);

  // 返信テキストエリアに入力
  const textarea = page.locator('[data-testid="tweetTextarea_0"]').first();
  await textarea.waitFor({ timeout: 8_000 });
  await textarea.click();
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForTimeout(500);

  // 「返信する」ボタンをクリック
  const submitBtn = page.locator('[data-testid="tweetButtonInline"]').first();
  await submitBtn.waitFor({ timeout: 5_000 });
  await submitBtn.click();
  await page.waitForTimeout(2_000);

  // 投稿後 URL からツイートIDを取得（取れなければ tweetId を返す）
  const postedUrl = page.url();
  const m = postedUrl.match(/\/status\/(\d+)/);
  return m ? m[1] : tweetId;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── メイン ───────────────────────────────────────────────────────

export async function runCoattailReply(opts = {}) {
  const config    = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'));
  const maxPerRun = opts.maxPerRun ?? config.maxPerRun ?? 8;
  const maxPerDay = config.maxPerDay ?? 20;

  // 日次上限チェック
  const todayCount = countTodayReplied();
  if (todayCount >= maxPerDay) {
    logger.info(MODULE, `daily limit reached (${todayCount}/${maxPerDay}), skipping`);
    return;
  }
  const remaining = Math.min(maxPerRun, maxPerDay - todayCount);

  const targets = config.targets.filter(t => t.active !== false);
  if (targets.length === 0) {
    logger.info(MODULE, 'no active targets');
    return;
  }

  logger.info(MODULE, `start. today: ${todayCount}/${maxPerDay}, this run: max ${remaining}`);

  const repliedIds = loadReplied();
  let totalPosted  = 0;

  const { browser, page } = await getXBrowser({ headless: true });

  try {
    for (const target of targets) {
      if (totalPosted >= remaining) break;

      const tweets = await fetchRecentTweets(page, target.handle, 3);

      for (const tweet of tweets) {
        if (totalPosted >= remaining) break;

        if (repliedIds.has(tweet.tweetId)) {
          logger.info(MODULE, `already replied to ${tweet.tweetId}, skipping`);
          continue;
        }

        try {
          const replyText = await generateReply(tweet);
          logger.info(MODULE, `posting reply to @${tweet.handle}/${tweet.tweetId}`, { replyText });

          await postCoattailReply(tweet.tweetId, replyText, page);
          recordReplied(tweet.tweetId, tweet.handle, replyText);
          repliedIds.add(tweet.tweetId);
          totalPosted++;

          // シャドウバン防止インターバル: 3〜8秒ランダム
          await sleep(3_000 + Math.random() * 5_000);
        } catch (err) {
          if (err.isRateLimit) {
            logger.warn(MODULE, 'rate limited — aborting run');
            return; // browser.close は finally で実行
          }
          logger.warn(MODULE, `reply failed for ${tweet.tweetId}: ${err.message}`);
        }
      }

      // アカウント間インターバル: 30〜60秒（バースト回避）
      await sleep(30_000 + Math.random() * 30_000);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  logger.info(MODULE, `done. posted: ${totalPosted}, today total: ${todayCount + totalPosted}/${maxPerDay}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCoattailReply();
}
