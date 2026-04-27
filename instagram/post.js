/**
 * Instagram 投稿モジュール（Graph API）
 *
 * 前提: Instagram Creator/Business アカウント（Facebook Page 不要）
 *       Instagram Login トークン（INSTAGRAM_ACCESS_TOKEN_1/2）が必要
 *
 * フロー:
 *   1. drafts/{today}/post.json を読み込む
 *   2. 画像URLが必要なため、画像を外部URLにアップロード（または既存URLを使用）
 *   3. Graph API でメディアコンテナ作成
 *   4. メディア公開
 *
 * 未設定時: drafts に保存して通知のみ（フォールバック）
 */
import 'dotenv/config';
import fs from 'fs';
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const MODULE     = 'instagram:post';

function getCredentials(account) {
  const suffix    = account === 2 ? '_2' : '_1';
  const altSuffix = String(account); // e.g. "1" or "2" (no leading underscore variant)
  return {
    accessToken: process.env[`INSTAGRAM_ACCESS_TOKEN${suffix}`]
      ?? process.env[`INSTAGRAM_ACCESS_TOKEN${altSuffix}`]
      ?? process.env.INSTAGRAM_ACCESS_TOKEN,
    accountId: process.env[`INSTAGRAM_BUSINESS_ACCOUNT_ID${suffix}`]
      ?? process.env[`INSTAGRAM_BUSINESS_ACCOUNT_ID${altSuffix}`]
      ?? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  };
}

export async function runPost({ account = 1, type = 'auto' } = {}) {
  const today     = new Date().toISOString().split('T')[0];
  const draftDir  = path.join(DRAFTS_DIR, `account${account}`, today);
  const draftPath = path.join(draftDir, 'post.json');

  if (!fs.existsSync(draftPath)) {
    logger.warn(MODULE, `no draft for account${account} today: ${draftPath}`);
    return { posted: false, reason: 'no draft', account };
  }

  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

  // reels explicitly requested but no video uploaded yet
  if (type === 'reels' && !draft.reelsVideoUrl) {
    logger.warn(MODULE, `account${account}: reels requested but reelsVideoUrl not set — run render/upload first`);
    return { posted: false, reason: 'no_reels_video', account };
  }

  // type-specific duplicate check
  const isReelsRequest = type === 'reels' || (type === 'auto' && !!draft.reelsVideoUrl);
  const postedKey = isReelsRequest ? 'reelsPosted' : 'imagePosted';
  if (draft[postedKey]) {
    logger.info(MODULE, `account${account}: ${postedKey} already — skipping`);
    return { posted: false, reason: 'already_posted', account };
  }

  const { accessToken, accountId } = getCredentials(account);

  if (!accessToken || !accountId) {
    logger.warn(MODULE, `account${account}: credentials not set — saving as pending`);
    return savePending(draftPath, draft, undefined, account);
  }

  // force image type when explicitly requested
  const draftForPost = (type === 'image')
    ? { ...draft, reelsVideoUrl: null }
    : draft;

  try {
    const postId = await postViaGraphApi(draftForPost, accessToken, accountId);
    markPosted(draftPath, draft, postId, postedKey);
    logger.info(MODULE, `account${account} ${isReelsRequest ? 'reels' : 'image'} posted: ${postId}`);
    return { posted: true, postId, account };
  } catch (err) {
    logger.error(MODULE, `account${account} Graph API error: ${err.message}`);
    return savePending(draftPath, draft, err.message, account);
  }
}

// ── Graph API 投稿 ──────────────────────────────────────────────────

async function postViaGraphApi(draft, accessToken, accountId) {
  const host = accessToken.startsWith('EAA') ? 'graph.facebook.com' : 'graph.instagram.com';
  const BASE = `https://${host}/v21.0/${accountId}`;
  const apiHost = host;

  // Reels（動画）か画像かを判定
  const videoUrl = draft.reelsVideoUrl ?? null;
  const imageUrl = draft.imageUrl ?? draft.fallbackImageUrl;
  const isReels  = !!videoUrl;

  if (!videoUrl && !imageUrl) {
    throw new Error('imageUrl / reelsVideoUrl not set in draft — upload media first');
  }

  // Step 1: メディアコンテナ作成
  const containerBody = isReels
    ? { media_type: 'REELS', video_url: videoUrl, caption: draft.caption, access_token: accessToken }
    : { image_url: imageUrl,                       caption: draft.caption, access_token: accessToken };

  logger.info(MODULE, `creating container: ${isReels ? 'REELS' : 'IMAGE'}`);
  const containerRes = await fetch(`${BASE}/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(containerBody),
  });

  const container = await containerRes.json();
  if (!container.id) {
    throw new Error(`container creation failed: ${JSON.stringify(container)}`);
  }

  // Step 2: コンテナ処理完了を待つ（Reels は最大5分、画像は最大30秒）
  const maxPolls   = isReels ? 60 : 10;
  const pollInterval = isReels ? 5000 : 3000;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    const statusRes = await fetch(
      `https://${apiHost}/v21.0/${container.id}?fields=status_code&access_token=${accessToken}`
    );
    const { status_code } = await statusRes.json();
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR') throw new Error('container processing failed: status_code=ERROR');
  }

  // Step 3: 公開
  const publishRes = await fetch(`${BASE}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ creation_id: container.id, access_token: accessToken }),
  });

  const published = await publishRes.json();
  if (!published.id) {
    throw new Error(`publish failed: ${JSON.stringify(published)}`);
  }

  return published.id;
}

// ── ヘルパー ────────────────────────────────────────────────────────

function markPosted(draftPath, draft, postId, postedKey = 'imagePosted') {
  const { pendingReason: _, updatedAt: __, ...rest } = draft;
  const bothPosted = rest.imagePosted && rest.reelsPosted
    || (postedKey === 'imagePosted' && rest.reelsPosted)
    || (postedKey === 'reelsPosted' && rest.imagePosted);
  saveJSON(draftPath, {
    ...rest,
    [postedKey]: true,
    status:   bothPosted ? 'posted' : rest.status,
    postId,
    postedAt: new Date().toISOString(),
  });
}

function savePending(draftPath, draft, reason, account) {
  saveJSON(draftPath, {
    ...draft,
    status:        'pending',
    pendingReason: reason ?? 'credentials not set',
    updatedAt:     new Date().toISOString(),
  });
  return { posted: false, reason: reason ?? 'pending', account };
}
