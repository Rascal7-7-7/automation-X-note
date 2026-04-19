/**
 * Ghost投稿モジュール
 * - ghost/drafts/ から最古の未投稿ドラフトを取得
 * - Ghost Admin API で投稿（published or draft）
 * - 投稿後に status を "posted" に更新
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import GhostAdminAPI from '@tryghost/admin-api';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const TWEET_SYSTEM = `You are a social media manager for Rascal.AI — an English blog about AI automation and side income.
Write a single promotional tweet (≤260 chars) for a new blog post.
Rules:
- English only
- Hook first: start with a stat, question, or bold claim
- Include the URL at the end
- 2-3 relevant hashtags: #AI #Automation #SideIncome #AITools #Productivity
- No quotes around the tweet
- Output tweet text only`;

async function generatePromoTweet(title, excerpt, url) {
  const prompt = `New blog post:\nTitle: ${title}\nExcerpt: ${excerpt}\nURL: ${url}`;
  return generate(TWEET_SYSTEM, prompt, { model: 'claude-haiku-4-5-20251001', maxTokens: 200 });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'ghost:post';
const DRAFTS_DIR = path.join(__dirname, 'drafts');

function createClient() {
  const url = process.env.GHOST_URL;
  const key = process.env.GHOST_ADMIN_KEY;
  if (!url || !key) throw new Error('GHOST_URL and GHOST_ADMIN_KEY required in .env');
  return new GhostAdminAPI({ url, key, version: 'v5.0' });
}

function findOldestDraft() {
  if (!fs.existsSync(DRAFTS_DIR)) return null;
  return fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const filePath = path.join(DRAFTS_DIR, f);
      return { filePath, draft: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    })
    .filter(f => f.draft.status === 'draft')
    .sort((a, b) => (a.draft.createdAt ?? '').localeCompare(b.draft.createdAt ?? ''))[0] ?? null;
}

function markPosted(filePath, ghostUrl) {
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = { ...draft, status: 'posted', postedAt: new Date().toISOString(), ghostUrl };
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, filePath);
}

export async function runPost(opts = {}) {
  const isDev = (opts.mode ?? process.env.MODE ?? 'dev') === 'dev';
  const file = findOldestDraft();

  if (!file) {
    logger.info(MODULE, 'no drafts to post');
    return;
  }

  const { draft } = file;
  logger.info(MODULE, `posting: ${draft.title}`);

  const api = createClient();
  const postStatus = isDev ? 'draft' : 'published';

  const metaDesc = draft.summary ?? draft.excerpt ?? '';
  const payload = {
    title: draft.title,
    html: draft.html ?? `<p>${draft.body ?? ''}</p>`,
    status: postStatus,
    custom_excerpt: metaDesc,
    tags: (draft.tags ?? []).map(t => ({ name: t })),
    meta_title:           draft.title,
    meta_description:     metaDesc,
    og_title:             draft.title,
    og_description:       metaDesc,
    twitter_title:        draft.title,
    twitter_description:  metaDesc,
  };

  if (draft.featureImage) {
    payload.feature_image    = draft.featureImage;
    payload.og_image         = draft.featureImage;
    payload.twitter_image    = draft.featureImage;
  }
  if (draft.newsletterId && !isDev) {
    payload.newsletter = { id: draft.newsletterId };
  }

  const post = await api.posts.add(payload, { source: 'html' });
  const ghostUrl = post.url ?? `${process.env.GHOST_URL}/p/${post.id}`;

  markPosted(file.filePath, ghostUrl);
  logger.info(MODULE, `${postStatus}: ${ghostUrl}`);

  // X プロモツイート（prod のみ）
  if (!isDev) {
    try {
      const { postTweet } = await import('../x/post.js');
      const tweet = await generatePromoTweet(draft.title, draft.excerpt ?? draft.summary ?? '', ghostUrl);
      const result = await postTweet(tweet);
      const tweetId = result?.data?.id ?? result?.id;
      logger.info(MODULE, `x promo posted: ${tweetId}`);
    } catch (err) {
      logger.warn(MODULE, `x promo failed (non-fatal): ${err.message}`);
    }
  }

  return { ghostUrl, title: draft.title };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPost().catch(err => { logger.error(MODULE, err.message); process.exit(1); });
}
