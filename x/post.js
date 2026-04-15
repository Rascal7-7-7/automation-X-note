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

【文字数・改行】
- 全体: 120〜140文字（全角）
- 1行あたり最大20文字で改行する
- セクション間は1行空け（連続空行禁止）

【冒頭1行（スクロール停止ライン）— 必ずどれか1つを使う】
1. 【朗報/速報/必見/保存版】+ 結果
2. 数字+成果: 「月5万稼いだAI副業の全手順」
3. ターゲット指定: 「AI副業を始めたい人へ」
4. 意外性: 「9割が知らない〇〇」「正直に言う」
5. 数字リード: 「AIツール7選を試した結果」
※冒頭行に絵文字を入れない

【構造テンプレート（1つ選ぶ）】
A. 問題提起1行
（空行）
・解決策1
・解決策2
・解決策3
（空行）
質問CTA

B. 結果（数字付き）
（空行）
理由・具体例を2〜3行

C. 【保存版】チェックリスト
□ 項目1
□ 項目2
□ 項目3
ブクマCTA

【絵文字・ハッシュタグ】
- 絵文字は最大2個・CTAの末尾のみ（👇📌✅💡🔥⚡）
- ハッシュタグは最大2個・本文末尾に置く
- 本文にURLを絶対に入れない

【末尾CTA（必須）】
「〇〇の人はリプで教えて👇」「ブクマ推奨📌」「役立ったらRTしてくれると嬉しいです」のどれか1つ

【禁止】
「今日は〇〇について書きます」等の導入文・ハッシュタグ3個以上・宣伝・誇張`;

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
