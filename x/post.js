/**
 * X (Twitter) 投稿モジュール
 * - ideas キューからアイデアを取得
 * - Claude Haiku でツイート文を生成
 * - Twitter API v2 で投稿
 */
import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import { generate } from '../shared/claude-client.js';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
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

const twitterClient = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

const ideaQueue = new FileQueue(path.join(__dirname, 'queue/ideas.jsonl'));
const postedLog = path.join(__dirname, 'queue/posted.jsonl');

async function generateTweet(idea) {
  const prompt = `以下のトレンド情報をもとに、AIや副業に関心のある日本人向けのツイートを1件作成してください。
キーワード: ${idea.keyword}
参考ツイート: ${idea.text ?? ''}`;

  return generate(SYSTEM_PROMPT, prompt, { maxTokens: 300 });
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

    const { data } = await twitterClient.v2.tweet(tweetText);
    logger.info(MODULE, 'posted', { tweetId: data.id });

    import('fs').then(({ appendFileSync }) =>
      appendFileSync(postedLog, JSON.stringify({
        tweetId: data.id,
        text: tweetText,
        postedAt: new Date().toISOString(),
        idea,
      }) + '\n')
    );
  } catch (err) {
    logger.error(MODULE, 'post failed', { message: err.message });
    // アイデアを戻す（再試行可能にする）
    ideaQueue.push(idea);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPost();
}
