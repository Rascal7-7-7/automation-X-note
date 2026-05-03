/**
 * note 告知ツイートの3日後引用RT（別角度リプロモ）
 *
 * フロー:
 *   note-promo-log.jsonl を読む
 *     ↓ postedAt から3日経過 かつ repromoDone !== true
 *   Claude Haiku で「別角度」引用RTテキスト生成（100文字以内）
 *     ↓
 *   postQuoteTweet(text, tweetId)
 *     ↓
 *   log の repromoDone:true, repromoPostedAt を更新
 */
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import { canPost } from '../shared/daily-limit.js';
import { postQuoteTweet } from './pipeline.js';
import { loadPromoLog, updatePromoLogEntry } from './promo-log.js';

const MODULE = 'x:note-repromo-rt';
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// アカウント別ペルソナ（Haiku へのコンテキスト）
const PERSONA = {
  1: 'AI活用・副業・自動化をテーマに発信するアカウント',
  2: '投資・FX・AI自動売買をテーマに発信するアカウント',
  3: 'アフィリエイト副業をテーマに発信するアカウント',
};

async function generateRepromoText(entry) {
  const persona = PERSONA[entry.account] ?? PERSONA[1];
  const system = `あなたは${persona}です。
3日前に投稿した告知ツイートを引用RTします。
【ルール】
- 100文字以内（厳守）
- 最初の告知とは別の切り口・角度で価値を伝える
- URLは含めない
- ハッシュタグなし
- 「3日前」「再告知」などの言及不要
- 読んでいない人が「気になる」と感じる一言にする`;

  const prompt = `記事タイトル: ${entry.title}
note URL: ${entry.noteUrl}
最初の告知から3日経過しています。別角度で価値を伝える引用RTテキストを1件だけ出力してください。`;

  const raw = await generate(system, prompt, { maxTokens: 200 });
  const text = raw.trim().slice(0, 100);
  logger.info(MODULE, `generated: ${text}`);
  return text;
}

export async function runRepromoRT(opts = {}) {
  const isDev = (opts.mode ?? process.env.MODE ?? 'dev') === 'dev';
  const now = Date.now();

  const entries = loadPromoLog();
  const targets = entries.filter(e => {
    if (!e.tweetId || !e.postedAt || e.repromoDone) return false;
    const ts = new Date(e.postedAt).getTime();
    if (isNaN(ts)) {
      logger.warn(MODULE, `invalid postedAt for tweetId=${e.tweetId} — skipping`);
      return false;
    }
    return (now - ts) >= THREE_DAYS_MS;
  });

  if (targets.length === 0) {
    logger.info(MODULE, 'no entries ready for repromo-rt');
    return;
  }

  logger.info(MODULE, `${targets.length} entries eligible for repromo-rt`);

  for (const entry of targets) {
    logger.info(MODULE, `processing: "${entry.title}" (tweetId=${entry.tweetId})`);

    try {
      const text = await generateRepromoText(entry);

      if (isDev) {
        console.log('\n--- DEV MODE: REPROMO-RT (not posted) ---');
        console.log(`Quote tweet of: ${entry.tweetId}`);
        console.log(text);
        console.log('-----------------------------------------\n');
        continue;
      }

      // canPost() はスロットを消費するので生成成功後に確認
      if (!canPost()) {
        logger.warn(MODULE, 'daily limit reached — stopping');
        break;
      }

      const newTweetId = await postQuoteTweet(text, entry.tweetId);
      logger.info(MODULE, `quote-rt posted: ${newTweetId} (quoting ${entry.tweetId})`);

      updatePromoLogEntry(entry.tweetId, {
        repromoDone:      true,
        repromoPostedAt:  new Date().toISOString(),
        repromoTweetId:   newTweetId,
      });
    } catch (err) {
      logger.error(MODULE, `failed for tweetId=${entry.tweetId}: ${err.message}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRepromoRT();
}
