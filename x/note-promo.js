/**
 * note記事 → X 告知投稿
 *
 * 安全条件（全て満たす場合のみ投稿）:
 *   - draft.status === 'posted'   ← 下書きは告知しない
 *   - draft.noteUrl が存在        ← URLなしは告知不可
 *   - draft.promoPosted !== true  ← 二重投稿防止
 *
 * フロー:
 *   find posted draft
 *     ↓ Claude Haiku
 *   generate promo tweet
 *     ↓
 *   validateTweet（ルールベース）
 *     ↓
 *   reviewTweet（AI、prodのみ）
 *     ↓
 *   postTweet
 *     ↓
 *   draft.promoPosted = true
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { validateTweet, reviewTweet, postTweet } from './pipeline.js';
import { logXPost } from '../analytics/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:note-promo';
const DRAFTS_DIR = path.join(__dirname, '../note/drafts');

const PROMO_SYSTEM = `あなたはAI活用・副業をテーマに発信するXアカウントです。
note記事の情報からX告知ツイートを1件作成してください。

ルール:
- 140文字以内（日本語）
- 記事タイトル・読むメリット・短い要約・noteのURLを含める
- 読者が「読みたい」と思う表現にする
- 宣伝くさい文体は禁止
- ハッシュタグは1〜2個
- URL込みで140文字以内に収めること（URLは23文字として計算）
- 末尾に改行なし`;

// ── ドラフト操作 ─────────────────────────────────────────────────────
function findPromoTarget() {
  if (!fs.existsSync(DRAFTS_DIR)) return null;

  const files = fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ filePath: path.join(DRAFTS_DIR, f) }))
    .map(f => ({ ...f, draft: JSON.parse(fs.readFileSync(f.filePath, 'utf8')) }))
    .filter(f =>
      f.draft.status === 'posted' &&
      f.draft.noteUrl &&
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
URL: ${draft.noteUrl}
テーマ: ${draft.theme}`;

  return generate(PROMO_SYSTEM, prompt, { maxTokens: 300 });
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
