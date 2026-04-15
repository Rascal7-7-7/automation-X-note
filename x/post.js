/**
 * X (Twitter) 投稿モジュール
 * - ideas キューからアイデアを取得
 * - Claude Haiku でツイート文を生成
 * - xurl CLI で投稿（twitter-api-v2 不要）
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { generate } from '../shared/claude-client.js';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import { appendFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:post';

const SYSTEM_PROMPT = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
以下のルールで日本語ツイートを1件作成してください。

【必須ルール】
- 改行を8〜10回使う（エンゲージ率最大化）
- 1行20〜30文字以内
- URLを本文に入れない
- ハッシュタグ最大2個・末尾のみ
- 一行だけの投稿は絶対禁止

【冒頭1行（スクロール停止）— 絵文字を入れない】
・数字+成果: 「ChatGPTで作業時間を90分削減した方法」
・意外性: 「9割のAI副業が稼げない本当の理由」
・【朗報/必見/保存版】+結果
・ターゲット: 「AI副業を始めたい人へ」

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
一行だけ/改行なし/「今日は〇〇について書きます」系の導入/ハッシュタグ3個以上/宣伝・誇張`;

const ideaQueue = new FileQueue(path.join(__dirname, 'queue/ideas.jsonl'));
const postedLog = path.join(__dirname, 'queue/posted.jsonl');

async function generateTweet(idea) {
  const prompt = `以下のトレンド情報をもとに、AIや副業に関心のある日本人向けのツイートを1件作成してください。
キーワード: ${idea.keyword}
参考ツイート: ${idea.text ?? ''}`;
  return generate(SYSTEM_PROMPT, prompt, { maxTokens: 300 });
}

function xurlPost(text) {
  const raw = execFileSync('xurl', ['post', text], { encoding: 'utf8' });
  return JSON.parse(raw);
}

export async function runPost() {
  const idea = await ideaQueue.shift();
  if (!idea) {
    logger.info(MODULE, 'no ideas in queue, skipping');
    return;
  }

  try {
    const tweetText = await generateTweet(idea);
    logger.info(MODULE, 'generated tweet', { text: tweetText });

    const result = xurlPost(tweetText);
    const tweetId = result?.data?.id ?? result?.id;
    logger.info(MODULE, 'posted', { tweetId });

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
