/**
 * Ghost記事リサーチモジュール
 * - Reddit JSON API（認証不要）でAI系トレンド取得
 * - Hacker News API でテック系トレンド取得
 * - ghost/queue/ideas.jsonl にトピックとして保存
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'ghost:research';
const ideaQueue = new FileQueue(path.join(__dirname, 'queue/ideas.jsonl'));

const SUBREDDITS = ['artificial', 'ChatGPT', 'LocalLLaMA', 'MachineLearning', 'singularity'];

const BLOCK_KEYWORDS = [
  'genocide', 'war', 'military', 'weapon', 'kill', 'dead', 'murder',
  'suicide', 'violence', 'terrorist', 'israel', 'gaza', 'ukraine',
  'russia', 'trump', 'biden', 'democrat', 'republican', 'election',
  'lawsuit', 'arrested', 'prison', 'scandal', 'racist', 'abuse',
];

const HEADERS = {
  'User-Agent': 'GhostAutomation/1.0 (blog content research)',
  'Accept': 'application/json',
};

function isBlocked(text) {
  const lower = text.toLowerCase();
  return BLOCK_KEYWORDS.some(kw => lower.includes(kw));
}

async function fetchReddit(subreddit) {
  try {
    const res = await fetch(`https://www.reddit.com/r/${subreddit}/top.json?t=week&limit=10`, { headers: HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.children ?? [])
      .map(c => c.data)
      .filter(p => p.score >= 500 && !isBlocked(p.title))
      .map(p => ({
        id: p.id,
        title: p.title,
        score: p.score,
        comments: p.num_comments,
        subreddit: p.subreddit,
        url: `https://reddit.com${p.permalink}`,
        selftext: (p.selftext ?? '').slice(0, 500),
      }));
  } catch (err) {
    logger.warn(MODULE, `reddit/${subreddit} failed: ${err.message}`);
    return [];
  }
}

async function fetchHN() {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const ids = (await res.json()).slice(0, 20);
    const items = await Promise.all(
      ids.map(id =>
        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
          .then(r => r.json())
          .catch(() => null)
      )
    );
    return items
      .filter(i => i && i.score >= 100 && i.title && !isBlocked(i.title))
      .filter(i => /ai|llm|claude|gpt|automation|agent/i.test(i.title))
      .map(i => ({
        id: `hn_${i.id}`,
        title: i.title,
        score: i.score,
        comments: i.descendants ?? 0,
        subreddit: 'HackerNews',
        url: i.url ?? `https://news.ycombinator.com/item?id=${i.id}`,
        selftext: '',
      }));
  } catch (err) {
    logger.warn(MODULE, `HN fetch failed: ${err.message}`);
    return [];
  }
}

export async function runResearch(opts = {}) {
  logger.info(MODULE, 'fetching Reddit + HN trends');

  const [hnPosts, ...redditResults] = await Promise.all([
    fetchHN(),
    ...SUBREDDITS.map(fetchReddit),
  ]);

  const redditPosts = redditResults.flat();
  const allPosts = [...redditPosts, ...hnPosts]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  logger.info(MODULE, `found ${allPosts.length} trending posts`);

  for (const post of allPosts.slice(0, 3)) {
    await ideaQueue.push({
      topic: post.title,
      redditContext: post.selftext,
      sourceUrl: post.url,
      sourcePlatform: post.subreddit,
      score: post.score,
      queuedAt: new Date().toISOString(),
    });
    logger.info(MODULE, `queued: ${post.title.slice(0, 60)}`);
  }

  return allPosts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runResearch().then(posts => {
    console.log(`Queued ${Math.min(posts.length, 3)} topics`);
    posts.slice(0, 5).forEach(p => console.log(`  [${p.score}] ${p.title}`));
  }).catch(err => { logger.error(MODULE, err.message); process.exit(1); });
}
