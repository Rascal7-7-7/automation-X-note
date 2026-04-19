/**
 * X (Twitter) 投稿モジュール
 * - ideas キューからアイデアを取得
 * - Claude Haiku でツイート文を生成
 * - twitter-api-v2 で投稿
 * - X_IMAGE_ENABLED=true の場合、DALL-E 3 で画像を生成して添付
 */
import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import OpenAI from 'openai';
import https from 'https';
import { generate } from '../shared/claude-client.js';
import { generateWithReview } from '../shared/multi-persona-reviewer.js';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import { appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:post';

const IMAGE_ENABLED = process.env.X_IMAGE_ENABLED === 'true';

// ── OpenAI 遅延初期化 ─────────────────────────────────────────────────
let openai = null;
function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set — X image generation unavailable');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const IMAGE_PROMPT_SYSTEM = `ツイートの内容に合った正方形（1:1）のSNS投稿用画像のDALL-Eプロンプトを英語で1行生成してください。
- インフォグラフィック風、清潔感のあるデザイン
- 日本語テキストは含めない
- 人物は含めてもよい（日本人、ビジネスカジュアル）
- ブランドカラー: 深い青 + 白 + アクセントゴールド
出力: プロンプト1行のみ`;

/**
 * ツイートテキストから画像プロンプトを生成し、DALL-E 3 で画像を生成する。
 * @param {string} tweetText
 * @returns {Promise<Buffer>} 画像バイナリ
 */
async function generateTweetImage(tweetText) {
  const imagePrompt = await generate(
    IMAGE_PROMPT_SYSTEM,
    `以下のツイート内容に合う画像プロンプトを生成してください:\n${tweetText}`,
    { maxTokens: 200 },
  );
  logger.info(MODULE, 'image prompt generated', { imagePrompt });

  const res = await getOpenAI().images.generate({
    model:           'dall-e-3',
    prompt:          imagePrompt.trim(),
    n:               1,
    size:            '1024x1024',
    quality:         'standard',
    response_format: 'url',
  });

  const imageUrl = res.data[0].url;
  logger.info(MODULE, 'DALL-E 3 returned URL');
  return downloadToBuffer(imageUrl);
}

/** HTTPS URL から Buffer にダウンロード */
function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`image download failed: HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (c) => chunks.push(c));
      response.on('end',  ()  => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

const SYSTEM_PROMPT = `あなたは副業・節約・時短をテーマに自分の実体験を発信する会社員です。
AIツールを使っていますが、それは絶対に明かしません。
以下のルールで日本語ツイートを1件作成してください。

【必須ルール】
- 改行を8〜10回使う（エンゲージ率最大化）
- 1行20〜30文字以内
- URLを本文に入れない
- ハッシュタグ最大2個・末尾のみ
- 一行だけの投稿は絶対禁止
- AIツール名（ChatGPT/Claude等）を主役にしない
- 「私が実際に〇〇した」「やってみたら〇〇だった」の実体験口調

【冒頭1行（スクロール停止）— 絵文字を入れない】
・数字+成果: 「副業収入が月3万増えた、たった1つの習慣」
・意外性: 「9割の副業が稼げない本当の理由、言います」
・【朗報/必見/保存版】+結果
・ターゲット: 「本業しながら副業したい人へ」

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
「詳しくはnoteに書いたので興味あれば見てね」「もっと知りたい人はプロフのnoteへ」「[条件]の人はリプで教えて👇」「ブクマ推奨📌」

【禁止】
一行だけ/改行なし/「今日は〇〇について書きます」系の導入/ハッシュタグ3個以上/宣伝・誇張/AIツール名を主役にした内容`;

const ideaQueue = new FileQueue(path.join(__dirname, 'queue/ideas.jsonl'));
const postedLog = path.join(__dirname, 'queue/posted.jsonl');

async function generateTweet(idea, hint = '') {
  const prompt = `以下のトレンド情報をもとに、副業・節約・時短に関心のある会社員向けのツイートを1件作成してください。
AIツールの名前は出さず、「自分が実践して成果が出た方法」として書いてください。
末尾にnote記事への誘導CTAを必ず入れてください。
キーワード: ${idea.keyword}
参考ツイート: ${idea.text ?? ''}${hint ? `\n\n改善指示:\n${hint}` : ''}`;
  return generate(SYSTEM_PROMPT, prompt, { maxTokens: 300 });
}

const twitterClient = new TwitterApi({
  appKey:        process.env.X_API_KEY,
  appSecret:     process.env.X_API_SECRET,
  accessToken:   process.env.X_ACCESS_TOKEN,
  accessSecret:  process.env.X_ACCESS_TOKEN_SECRET,
});

/**
 * ツイートを投稿する。IMAGE_ENABLED=true かつ imageBuffer 指定時は画像付き投稿。
 * @param {string} text
 * @param {Buffer|null} imageBuffer
 */
export async function postTweet(text, imageBuffer = null) {
  if (imageBuffer) {
    const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { mimeType: 'image/png' });
    return twitterClient.v2.tweet({ text, media: { media_ids: [mediaId] } });
  }
  return twitterClient.v2.tweet(text);
}

export async function runPost() {
  const idea = await ideaQueue.shift();
  if (!idea) {
    logger.info(MODULE, 'no ideas in queue, skipping');
    return;
  }

  try {
    const { content: tweetText, review } = await generateWithReview(
      (hint) => generateTweet(idea, hint), 'X', 'x-general'
    );
    logger.info(MODULE, 'generated tweet', { text: tweetText, score: review.avgScore });

    // 画像添付（X_IMAGE_ENABLED=true のときのみ。失敗してもテキスト投稿を継続）
    let imageBuffer = null;
    if (IMAGE_ENABLED) {
      try {
        imageBuffer = await generateTweetImage(tweetText);
        logger.info(MODULE, 'tweet image ready', { bytes: imageBuffer.length });
      } catch (imgErr) {
        logger.warn(MODULE, 'image generation failed — posting text only', { message: imgErr.message });
      }
    }

    const result = await postTweet(tweetText, imageBuffer);
    const tweetId = result?.data?.id ?? result?.id;
    logger.info(MODULE, 'posted', { tweetId, withImage: imageBuffer !== null });

    appendFileSync(postedLog, JSON.stringify({
      tweetId,
      text: tweetText,
      postedAt: new Date().toISOString(),
      idea,
    }) + '\n');
  } catch (err) {
    logger.error(MODULE, 'post failed', { message: err.message });
    await ideaQueue.push(idea);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPost();
}
