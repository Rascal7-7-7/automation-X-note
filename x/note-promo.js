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
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { validateTweet, reviewTweet, postTweet, postReply } from './pipeline.js';
import { logXPost } from '../analytics/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:note-promo';
const NOTE_ROOT = path.join(__dirname, '../note');

// アカウント別設定
const ACCOUNT_META = {
  1: { label: null,       persona: 'AI活用・副業をテーマに発信するXアカウント',       financialWarning: false },
  2: { label: '【投資×AI】', persona: '投資・FX・AI自動売買をテーマに発信するXアカウント', financialWarning: true  },
  3: { label: '【アフィリ】', persona: 'アフィリエイト副業をテーマに発信するXアカウント', financialWarning: false },
};

function buildPromoSystem(accountId = 1) {
  const meta = ACCOUNT_META[accountId] ?? ACCOUNT_META[1];
  const labelRule = meta.label
    ? `- ツイート冒頭に必ず「${meta.label}」を付ける`
    : '';
  const financialRule = meta.financialWarning
    ? `- 「必ず儲かる」「高収益保証」「確実に稼げる」等の表現は絶対禁止（X金融コンテンツ規制）
- リスクを示唆する表現を1つ含める（「リスク管理も解説」「失敗事例も公開」等）`
    : '';

  return `あなたは${meta.persona}です。
note記事の情報からX告知ツイートを1件作成してください。

【重要】URLは本文に含めない（URLはリプライで別途投稿する）

ルール:
${labelRule}
- 120文字以内（日本語）
- ティーザー形式：記事の価値・学べること・解決できる悩みを具体的に伝える
- 読者が「続きが読みたい」と思わせる表現にする（「▼詳しくはリプライへ」で締める）
- 宣伝くさい文体は禁止
- ハッシュタグは関連性があれば4個まで・末尾のみ
${financialRule}`;
}

// ── ドラフト操作 ─────────────────────────────────────────────────────
function findPromoTarget() {
  const subdirs = ['drafts', 'drafts/account2', 'drafts/account3'];
  const all = [];

  for (const sub of subdirs) {
    const dir = path.join(NOTE_ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .forEach(f => {
        try {
          const filePath = path.join(dir, f);
          const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (
            draft.status === 'posted' &&
            draft.noteUrl?.includes('/n/') &&
            draft.promoPosted !== true
          ) all.push({ filePath, draft });
        } catch { /* skip */ }
      });
  }

  return all.sort((a, b) =>
    (a.draft.postedAt ?? '').localeCompare(b.draft.postedAt ?? '')
  )[0] ?? null;
}

function markPromoPosted(filePath) {
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = { ...draft, promoPosted: true, promoPostedAt: new Date().toISOString() };
  saveJSON(filePath, updated);
}

// ── ツイート生成 ─────────────────────────────────────────────────────
async function generatePromoTweet(draft) {
  const accountId = draft.account ?? 1;
  const system = buildPromoSystem(accountId);
  const prompt = `記事タイトル: ${draft.title}
概要: ${draft.summary}
テーマ: ${draft.theme}`;

  const raw = await generate(system, prompt, { maxTokens: 300, model: 'claude-sonnet-4-6' });
  logger.info(MODULE, `generated ${raw.length}字`, { preview: raw.slice(0, 60) });

  if (raw.length > 270) {
    // 末尾のハッシュタグ行を除去して短縮を試みる
    const trimmed = raw.replace(/\n#\S+(\s+#\S+)*\s*$/, '').trimEnd();
    if (trimmed.length <= 270) {
      logger.warn(MODULE, `truncated hashtags: ${raw.length}→${trimmed.length}字`);
      return trimmed;
    }
    // それでも超えるなら硬截断
    const cut = raw.slice(0, 267) + '…';
    logger.warn(MODULE, `hard-truncated: ${raw.length}→${cut.length}字`);
    return cut;
  }
  return raw;
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
