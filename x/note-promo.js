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
import { validateTweet, postTweet, postReply } from './pipeline.js';
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
  const labelRule = meta.label ? `- ツイート冒頭に必ず「${meta.label}」を付ける` : '';
  const financialRule = meta.financialWarning
    ? `- 「必ず儲かる」「高収益保証」「確実に稼げる」等の表現は絶対禁止\n- リスクを示唆する表現を1つ含める`
    : '';

  return `あなたは${meta.persona}です。
note記事の情報からX告知ツイート（フックのみ）を1件作成してください。

【重要】URLは含めない。目次も含めない。フックだけ。

ルール:
${labelRule}
- 100文字以内（日本語）
- 冒頭1行で読者の悩みを刺す（数字・意外性・ターゲット刺しのいずれか）
- 2行目: 記事で解決できることを1文で
- 末尾: 「目次はリプライで↓」で締める
- 宣伝臭ゼロ・ハッシュタグなし（リプライ側で付ける）
${financialRule}`;
}

// ── paidBodyから見出し抽出 ──────────────────────────────────────────
function extractPaidHeadings(draft) {
  const src = draft.paidBody || draft.body || '';
  return src.split('\n')
    .filter(l => /^#{1,3}\s/.test(l.trim()))
    .map(l => l.replace(/^#+\s*/, '').trim())
    .filter(h => h.length > 0 && h.length < 40)
    .slice(0, 5);
}

// ── 目次リプライ本文を構築 ──────────────────────────────────────────
function buildContentsReply(draft) {
  const price = draft.price ? `¥${draft.price}` : '無料';
  const headings = extractPaidHeadings(draft);
  const isPaid = draft.price && parseInt(draft.price) > 0;

  if (isPaid && headings.length > 0) {
    const list = headings.map(h => `✅ ${h}`).join('\n');
    return `このnote（${price}）の中身を全部見せます\n\n${list}\n\n全部読める→リプライのURLから`;
  }

  // 無料記事 or 見出し取れない場合: summaryから価値訴求
  const summary = (draft.summary || '').slice(0, 100);
  return `この記事で得られること\n\n${summary}\n\n全文無料→リプライのURLから`;
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

    const tweetId = await postTweet(tweetText);
    logger.info(MODULE, `promo posted: ${tweetId}`);

    // Reply 1: 目次/contents reveal
    const contentsReply = buildContentsReply(draft);
    const reply1Id = await postReply(contentsReply, tweetId);
    logger.info(MODULE, `contents reply posted: ${reply1Id}`);

    // Reply 2: URL (chained to reply1 to form thread)
    const isPaid = draft.price && parseInt(draft.price) > 0;
    const urlReplyText = `▼ ${isPaid ? '購入' : '全文'}はこちら\n${draft.noteUrl}`;
    const reply2Id = await postReply(urlReplyText, reply1Id);
    logger.info(MODULE, `url reply posted: ${reply2Id}`);

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
