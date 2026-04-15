/**
 * Instagram 投稿モジュール（Graph API）
 *
 * 前提: Instagram Creator/Business アカウント + Facebook Page 連携済み
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
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const MODULE     = 'instagram:post';

function getCredentials(account) {
  const suffix = account === 2 ? '_2' : '_1';
  return {
    accessToken:  process.env[`INSTAGRAM_ACCESS_TOKEN${suffix}`]       ?? process.env.INSTAGRAM_ACCESS_TOKEN,
    accountId:    process.env[`INSTAGRAM_BUSINESS_ACCOUNT_ID${suffix}`] ?? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  };
}

export async function runPost({ account = 1 } = {}) {
  const today     = new Date().toISOString().split('T')[0];
  const draftDir  = path.join(DRAFTS_DIR, `account${account}`, today);
  const draftPath = path.join(draftDir, 'post.json');

  if (!fs.existsSync(draftPath)) {
    logger.warn(MODULE, `no draft for account${account} today: ${draftPath}`);
    return { posted: false, reason: 'no draft', account };
  }

  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  const { accessToken, accountId } = getCredentials(account);

  if (!accessToken || !accountId) {
    logger.warn(MODULE, `account${account}: credentials not set — saving as pending`);
    return savePending(draftPath, draft, undefined, account);
  }

  try {
    const postId = await postViaGraphApi(draft, accessToken, accountId);
    markPosted(draftPath, draft, postId);
    logger.info(MODULE, `account${account} posted: ${postId}`);
    return { posted: true, postId, account };
  } catch (err) {
    logger.error(MODULE, `account${account} Graph API error: ${err.message}`);
    return savePending(draftPath, draft, err.message, account);
  }
}

// ── Graph API 投稿 ──────────────────────────────────────────────────

async function postViaGraphApi(draft, accessToken, accountId) {
  // 新 Instagram API（IGAAN トークン用）
  const BASE = `https://graph.instagram.com/v21.0/${accountId}`;

  // Step 1: メディアコンテナ作成（image_url が必要）
  // ※ 画像はパブリックURLが必要。ローカル画像は別途CDN/S3等にアップロードすること
  const imageUrl = draft.imageUrl ?? draft.fallbackImageUrl;
  if (!imageUrl) {
    throw new Error('imageUrl not set in draft — upload image first');
  }

  const containerRes = await fetch(`${BASE}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url:    imageUrl,
      caption:      draft.caption,
      access_token: accessToken,
    }),
  });

  const container = await containerRes.json();
  if (!container.id) {
    throw new Error(`container creation failed: ${JSON.stringify(container)}`);
  }

  // Step 2: 公開
  const publishRes = await fetch(`${BASE}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id:  container.id,
      access_token: accessToken,
    }),
  });

  const published = await publishRes.json();
  if (!published.id) {
    throw new Error(`publish failed: ${JSON.stringify(published)}`);
  }

  return published.id;
}

// ── ヘルパー ────────────────────────────────────────────────────────

function markPosted(draftPath, draft, postId) {
  fs.writeFileSync(draftPath, JSON.stringify({
    ...draft,
    status:   'posted',
    postId,
    postedAt: new Date().toISOString(),
  }, null, 2));
}

function savePending(draftPath, draft, reason, account) {
  fs.writeFileSync(draftPath, JSON.stringify({
    ...draft,
    status:        'pending',
    pendingReason: reason ?? 'credentials not set',
    updatedAt:     new Date().toISOString(),
  }, null, 2));
  return { posted: false, reason: reason ?? 'pending', account };
}
