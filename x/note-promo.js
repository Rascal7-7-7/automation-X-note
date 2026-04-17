/**
 * note記事 → X 告知投稿
 *
 * 安全条件（全て満たす場合のみ投稿）:
 *   - draft.status === 'posted'   ← 下書きは告知しない
 *   - draft.noteUrl が存在        ← URLなしは告知不可
 *   - draft.promoPosted !== true  ← 二重投稿防止
 *
 * フロー:
 *   find posted draft（noteUrl に /n/ を含むもののみ）
 *     ↓ Claude Haiku
 *   generate promo tweet（URLなし・ティーザー形式）
 *     ↓
 *   validateTweet（ルールベース）
 *     ↓
 *   reviewTweet（AI、prodのみ）
 *     ↓
 *   postTweet（本文のみ）
 *     ↓
 *   postReply("▼ 記事はこちら\n{noteUrl}", tweetId)
 *     ↓
 *   draft.promoPosted = true
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { validateTweet, reviewTweet, postTweet, postReply } from './pipeline.js';
import { logXPost } from '../analytics/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:note-promo';
const DRAFTS_DIR = path.join(__dirname, '../note/drafts');

const PROMO_SYSTEM = `あなたはAI活用・副業をテーマに発信するXアカウントです。
note記事の情報からX告知ツイートを1件作成してください。

【重要】URLは本文に含めない（URLはリプライで別途投稿する）

ルール:
- 120文字以内（日本語）
- ティーザー形式：記事の価値・学べること・解決できる悩みを具体的に伝える
- 読者が「続きが読みたい」と思わせる表現にする（「▼詳しくはリプライへ」で締める）
- 宣伝くさい文体は禁止
- ハッシュタグは1〜2個・末尾のみ
- 末尾に改行なし

良い例:
「月5万円の副業を3ヶ月で達成した方法をnoteにまとめました。
ツール選び・時間配分・SNS戦略の3点を具体的に解説しています。
▼詳しくはリプライへ」`;

// ── ドラフト操作 ─────────────────────────────────────────────────────
function findPromoTarget() {
  if (!fs.existsSync(DRAFTS_DIR)) return null;

  const files = fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ filePath: path.join(DRAFTS_DIR, f) }))
    .map(f => ({ ...f, draft: JSON.parse(fs.readFileSync(f.filePath, 'utf8')) }))
    .filter(f =>
      f.draft.status === 'posted' &&
      f.draft.noteUrl?.includes('/n/') &&
      f.draft.promoPosted !== true
    )
    .sort((a, b) => (a.draft.postedAt ?? '').localeCompare(b.draft.postedAt ?? ''));

  return files[0] ?? null;
}

function markPromoPosted(filePath) {
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = { ...draft, promoPosted: true, promoPostedAt: new Date().toISOString() };
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, filePath);
}

// ── ツイート生成 ─────────────────────────────────────────────────────
async function generatePromoTweet(draft) {
  const prompt = `記事タイトル: ${draft.title}
概要: ${draft.summary}
テーマ: ${draft.theme}`;

  return generate(PROMO_SYSTEM, prompt, { maxTokens: 300, model: 'claude-sonnet-4-6' });
}

// ── メイン ───────────────────────────────────────────────────────────
export async function runNotePromo(opts = {}) {
  const isDev = (opts.mode ?? process.env.MODE ?? 'dev') === 'dev';

  const file = findPromoTarget();
  if (!file) {
    logger.info(MODULE, 'no posted articles ready for promo');
    return;
  }

  const { draft } = file;
  logger.info(MODULE, `generating promo for: ${draft.title}`);

  try {
    const tweetText = await generatePromoTweet(draft);
    logger.info(MODULE, 'generated promo tweet', { text: tweetText });

    const validation = validateTweet(tweetText);
    if (!validation.ok) {
      logger.warn(MODULE, `validate NG: ${validation.reason}`);
      return;
    }

    if (isDev) {
      console.log('\n--- DEV MODE: PROMO TWEET (not posted) ---');
      console.log(tweetText);
      console.log('-------------------------------------------\n');
      return;
    }

    const review = await reviewTweet(tweetText);
    if (!review.ok) {
      logger.warn(MODULE, `review NG: ${review.reason}`);
      return;
    }

    const tweetId = await postTweet(tweetText);
    logger.info(MODULE, `promo posted: ${tweetId}`);

    const replyText = `▼ 記事はこちら\n${draft.noteUrl}`;
    const replyId = await postReply(replyText, tweetId);
    logger.info(MODULE, `url reply posted: ${replyId}`);

    markPromoPosted(file.filePath);

    logXPost({
      tweetId,
      text: tweetText,
      type: 'promo',
      sourceTheme: draft.theme,
      noteUrl: draft.noteUrl,
    });
  } catch (err) {
    logger.error(MODULE, 'promo failed', { message: err.message });
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNotePromo();
}
