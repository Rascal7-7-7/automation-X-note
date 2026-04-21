/**
 * note記事 X 再告知（7日後・角度変えて）
 *
 * 条件:
 *   - draft.promoPosted === true
 *   - draft.promoPostedAt が 7日以上前
 *   - draft.repromo7d !== true（二重防止）
 *
 * 角度: 初回と異なる切り口（データ・体験談・逆説・質問形）で再告知
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
const MODULE = 'x:note-repromo';
const NOTE_ROOT = path.join(__dirname, '../note');

const ANGLE_OPTIONS = [
  '【データ角度】記事内の具体的数字・実績・比較表を前面に出す。「〇〇が△%向上」「〇日で達成」など定量的なフックで再告知。',
  '【逆説角度】「実はこれが間違いだった」「やってみて気づいた誤解」のように、記事の意外な洞察や反直感的な発見を軸にする。',
  '【質問形角度】読者に問いかける形（「あなたはこれ知ってましたか？」「〇〇できていますか？」）で再告知。コメントを誘発する。',
  '【体験談角度】著者の実体験・失敗談・転換点エピソードをフックに使う。「最初は〇〇だったのに今は△△」の変化ストーリー型。',
];

const REPROMO_SYSTEM = `あなたはAI活用・副業をテーマに発信するXアカウントです。
過去に告知済みのnote記事を、今回は【別の角度】から再告知するツイートを作成してください。

【今回の角度】
{ANGLE}

ルール:
- 120文字以内（日本語）
- 初回告知と明らかに異なる切り口にする（同じ表現の言い換えNG）
- URLは本文に含めない（リプライで別途投稿）
- 「▼詳しくはリプライへ」で締める
- ハッシュタグは関連性があれば3個まで・末尾のみ
- 宣伝くさい文体禁止`;

const SEVEN_DAYS_MS  = 7  * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// wave: '7d' | '30d'
function findRepromoTargets(wave) {
  const [daysMs, doneFlag, baseFlag] = wave === '30d'
    ? [THIRTY_DAYS_MS, 'repromo30d', 'repromo7d']
    : [SEVEN_DAYS_MS,  'repromo7d',  'promoPosted'];

  const targets = [];
  const accountDirs = ['drafts', 'drafts/account2', 'drafts/account3'];

  for (const subdir of accountDirs) {
    const dir = path.join(NOTE_ROOT, subdir);
    if (!fs.existsSync(dir)) continue;

    fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .forEach(f => {
        try {
          const filePath = path.join(dir, f);
          const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const baseTime = wave === '30d' ? draft.repromo7dAt : draft.promoPostedAt;
          if (
            draft.status === 'posted' &&
            draft.noteUrl?.includes('/n/') &&
            draft[baseFlag] === true &&
            draft[doneFlag] !== true &&
            baseTime &&
            Date.now() - new Date(baseTime).getTime() >= daysMs
          ) {
            targets.push({ filePath, draft });
          }
        } catch { /* skip malformed */ }
      });
  }

  return targets.sort((a, b) =>
    (a.draft.promoPostedAt ?? '').localeCompare(b.draft.promoPostedAt ?? '')
  );
}

function markRepromo(filePath, wave) {
  const flag = wave === '30d' ? 'repromo30d' : 'repromo7d';
  const tsKey = wave === '30d' ? 'repromo30dAt' : 'repromo7dAt';
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = { ...draft, [flag]: true, [tsKey]: new Date().toISOString() };
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, filePath);
}

async function generateRepromoTweet(draft, angle) {
  const system = REPROMO_SYSTEM.replace('{ANGLE}', angle);
  const prompt = `記事タイトル: ${draft.title}
概要: ${draft.summary ?? ''}
テーマ: ${draft.theme ?? ''}
初回告知日: ${draft.promoPostedAt?.slice(0, 10) ?? '不明'}`;

  return generate(system, prompt, { maxTokens: 300, model: 'claude-sonnet-4-6' });
}

async function runRepromoWave(wave, isDev) {
  const targets = findRepromoTargets(wave);
  if (targets.length === 0) {
    logger.info(MODULE, `no articles ready for repromo-${wave}`);
    return;
  }

  const { filePath, draft } = targets[0];
  const angle = ANGLE_OPTIONS[Math.floor(Math.random() * ANGLE_OPTIONS.length)];
  logger.info(MODULE, `repromo-${wave}: ${draft.title} | angle: ${angle.slice(0, 20)}`);

  const tweetText = await generateRepromoTweet(draft, angle);

  const validation = validateTweet(tweetText);
  if (!validation.ok) {
    logger.warn(MODULE, `validate NG: ${validation.reason}`);
    return;
  }

  if (isDev) {
    console.log(`\n--- DEV MODE: REPROMO-${wave} (not posted) ---`);
    console.log(tweetText);
    console.log('----------------------------------------------\n');
    return;
  }

  const review = await reviewTweet(tweetText);
  if (!review.ok) {
    logger.warn(MODULE, `review NG: ${review.reason}`);
    return;
  }

  const tweetId = await postTweet(tweetText);
  logger.info(MODULE, `repromo-${wave} posted: ${tweetId}`);
  await postReply(`▼ 記事はこちら\n${draft.noteUrl}`, tweetId);
  markRepromo(filePath, wave);

  logXPost({ tweetId, text: tweetText, type: `repromo-${wave}`, sourceTheme: draft.theme, noteUrl: draft.noteUrl });
}

export async function runRepromo(opts = {}) {
  const isDev = (opts.mode ?? process.env.MODE ?? 'dev') === 'dev';
  try {
    // 7日wave → 30日wave を順に処理（各1件/実行）
    await runRepromoWave('7d', isDev);
    await runRepromoWave('30d', isDev);
  } catch (err) {
    logger.error(MODULE, 'repromo failed', { message: err.message });
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRepromo();
}
