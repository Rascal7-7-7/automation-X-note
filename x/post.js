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
以下のルールでツイートを1件作成してください：
- 140文字以内（日本語）
- 学びになる具体的な情報を含める
- ハッシュタグは2〜3個
- 宣伝・誇張禁止
- 末尾に改行なし`;

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
  const idea = ideaQueue.shift();
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
    ideaQueue.push(idea);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPost();
}
