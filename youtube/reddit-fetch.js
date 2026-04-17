/**
 * Reddit 投稿フェッチモジュール
 *
 * Reddit JSON API（認証不要）で AI 系サブレディットの
 * 本日トップ投稿を取得し、youtube/queue/reddit_queue.json に保存する。
 *
 * 重複防止: youtube/queue/reddit_used_ids.json で処理済みID管理
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR     = path.join(__dirname, 'queue');
const QUEUE_FILE    = path.join(QUEUE_DIR, 'reddit_queue.json');
const USED_IDS_FILE = path.join(QUEUE_DIR, 'reddit_used_ids.json');
const MODULE        = 'youtube:reddit-fetch';

const SUBREDDITS = [
  'artificial',
  'ChatGPT',
  'LocalLLaMA',
  'singularity',
  'OpenAI',
];

// 政治・炎上・センシティブ投稿を除外するキーワード
const BLOCK_KEYWORDS = [
  'genocide', 'war', 'military', 'weapon', 'kill', 'dead', 'death',
  'murder', 'suicide', 'violence', 'terrorist', 'bomb', 'attack',
  'israel', 'gaza', 'ukraine', 'russia', 'china', 'trump', 'biden',
  'democrat', 'republican', 'election', 'politics', 'congress',
  'lawsuit', 'arrested', 'prison', 'fired', 'scandal',
  'racist', 'sexist', 'abuse', 'harass',
];

const HEADERS = {
  'User-Agent': 'AutomationBot/1.0 (YouTube content automation)',
  'Accept':     'application/json',
};

// ── 重複管理 ───────────────────────────────────────────────────────

function loadUsedIds() {
  try { return new Set(JSON.parse(fs.readFileSync(USED_IDS_FILE, 'utf8'))); }
  catch { return new Set(); }
}

function markUsed(id) {
  const ids  = loadUsedIds();
  ids.add(id);
  const arr = [...ids].slice(-500); // 直近500件のみ保持
  fs.writeFileSync(USED_IDS_FILE, JSON.stringify(arr), 'utf8');
}

// ── Reddit API ────────────────────────────────────────────────────

async function fetchTopPosts(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=15`;
  const res  = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for r/${subreddit}`);
  const data = await res.json();
  return data.data.children.map(c => c.data);
}

async function fetchTopComments(subreddit, postId) {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=15&depth=1`;
  const res  = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];

  const data = await res.json();
  return (data[1]?.data?.children ?? [])
    .filter(c => c.kind === 't1' && c.data.body && c.data.body !== '[deleted]' && c.data.score > 3)
    .sort((a, b) => b.data.score - a.data.score)
    .slice(0, 8)
    .map(c => ({ text: c.data.body.slice(0, 300), score: c.data.score }));
}

// ── メイン ────────────────────────────────────────────────────────

export async function runFetch() {
  if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

  const usedIds = loadUsedIds();

  for (const subreddit of SUBREDDITS) {
    let posts;
    try {
      posts = await fetchTopPosts(subreddit);
      logger.info(MODULE, `r/${subreddit}: ${posts.length} posts fetched`);
    } catch (err) {
      logger.warn(MODULE, `r/${subreddit} fetch failed: ${err.message}`);
      continue;
    }

    for (const post of posts) {
      // フィルタリング
      if (post.over_18)              continue; // NSFW
      if (usedIds.has(post.id))      continue; // 重複
      if (post.score < 200)          continue; // スコア低すぎ
      if (!post.title || post.title.length < 15) continue;

      // 政治・炎上・センシティブキーワードを含む投稿を除外
      const titleLower = post.title.toLowerCase();
      if (BLOCK_KEYWORDS.some(kw => titleLower.includes(kw))) continue;

      let comments = [];
      try {
        comments = await fetchTopComments(subreddit, post.id);
        await new Promise(r => setTimeout(r, 1000)); // rate limit 回避
      } catch (err) {
        logger.warn(MODULE, `comments fetch failed for ${post.id}: ${err.message}`);
      }

      if (comments.length < 2) continue; // コメントが少なすぎる投稿を除外

      // 画像URL抽出: 直接画像リンク → preview → null
      const directImageExts = /\.(jpg|jpeg|png|gif|webp)$/i;
      let imageUrl = null;
      if (post.url && directImageExts.test(post.url)) {
        imageUrl = post.url;
      } else if (post.preview?.images?.[0]?.source?.url) {
        imageUrl = post.preview.images[0].source.url.replace(/&amp;/g, '&');
      }

      // サムネイルURL: Reddit特殊値以外なら保存
      const REDDIT_THUMB_SPECIAL = new Set(['self', 'default', 'nsfw', 'spoiler']);
      const thumbnailUrl = (post.thumbnail && !REDDIT_THUMB_SPECIAL.has(post.thumbnail))
        ? post.thumbnail
        : null;

      const item = {
        id:         post.id,
        subreddit,
        title:      post.title,
        selftext:   (post.selftext ?? '').slice(0, 1200),
        score:      post.score,
        numComments: post.num_comments,
        url:        `https://www.reddit.com${post.permalink}`,
        imageUrl,
        thumbnailUrl,
        comments,
        fetchedAt:  new Date().toISOString(),
      };

      fs.writeFileSync(QUEUE_FILE, JSON.stringify(item, null, 2), 'utf8');
      markUsed(post.id);

      logger.info(MODULE, `queued → [r/${subreddit}] score:${post.score} "${post.title.slice(0, 60)}"`);
      return { fetched: true, item };
    }
  }

  logger.warn(MODULE, 'no suitable posts found across all subreddits');
  return { fetched: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFetch().then(r => console.log(JSON.stringify(r, null, 2)));
}
