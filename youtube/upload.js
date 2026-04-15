/**
 * YouTube アップロードモジュール（YouTube Data API v3）
 *
 * 前提: Google Cloud Console で OAuth2 認証設定済み
 *       YouTube Data API v3 有効化済み
 *
 * フロー:
 *   1. youtube/drafts/{today}/{type}.json を読み込む
 *   2. 認証情報未設定 → pending に保存して終了
 *   3. アクセストークン取得（リフレッシュトークンで更新）
 *   4. 動画ファイルをアップロード（resumable upload）
 *   5. サムネイル・メタデータを設定
 *   6. アップロード後に横展開（X/note/Instagram）をトリガー
 *
 * 必要な環境変数:
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 *   YOUTUBE_REFRESH_TOKEN
 *   YOUTUBE_CHANNEL_ID  （省略可）
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const MODULE     = 'youtube:upload';

const YT_API  = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const {
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  YOUTUBE_REFRESH_TOKEN,
} = process.env;

// ── メイン ──────────────────────────────────────────────────────────

export async function runUpload({ type = 'short', videoPath: overrideVideoPath } = {}) {
  const today     = new Date().toISOString().split('T')[0];
  const draftPath = path.join(DRAFTS_DIR, today, `${type}.json`);

  if (!fs.existsSync(draftPath)) {
    logger.warn(MODULE, `no draft for today (${type}): ${draftPath}`);
    return { uploaded: false, reason: 'no draft' };
  }

  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  const videoPath = overrideVideoPath ?? draft.videoPath;

  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    logger.warn(MODULE, 'YouTube credentials not set — saving as pending');
    return savePending(draftPath, draft, 'credentials not set');
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    logger.warn(MODULE, `video file not found: ${videoPath} — saving as pending`);
    return savePending(draftPath, draft, `video file not found: ${videoPath}`);
  }

  try {
    const accessToken = await refreshAccessToken();
    const videoId     = await uploadVideo(accessToken, draft, videoPath);

    markUploaded(draftPath, draft, videoId);
    logger.info(MODULE, `uploaded: https://www.youtube.com/watch?v=${videoId}`);

    return { uploaded: true, videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
  } catch (err) {
    logger.error(MODULE, `upload error: ${err.message}`);
    return savePending(draftPath, draft, err.message);
  }
}

// ── OAuth2 トークン更新 ──────────────────────────────────────────────

async function refreshAccessToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      refresh_token: YOUTUBE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`token refresh failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ── 動画アップロード（Resumable Upload） ──────────────────────────────

async function uploadVideo(accessToken, draft, videoPath) {
  const title       = draft.titles?.[0] ?? draft.theme;
  const isShort     = draft.type === 'short';
  const categoryId  = '28'; // 科学と技術（AI系コンテンツに適切）
  const fileSize    = fs.statSync(videoPath).size;
  const mimeType    = videoPath.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';

  const metadata = {
    snippet: {
      title,
      description: draft.description ?? '',
      tags:        draft.tags ?? [],
      categoryId,
    },
    status: {
      privacyStatus:           'public',
      selfDeclaredMadeForKids: false,
      ...(isShort ? {} : {}),
    },
  };

  // Step 1: Resumable upload セッション開始
  const initRes = await fetch(
    `${YT_UPLOAD}?uploadType=resumable&part=snippet,status`,
    {
      method:  'POST',
      headers: {
        Authorization:           `Bearer ${accessToken}`,
        'Content-Type':          'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`upload session init failed: ${err}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('upload session URL not returned');

  // Step 2: 動画ファイルをストリームでアップロード
  const fileStream = fs.createReadStream(videoPath);
  const chunks     = [];
  for await (const chunk of fileStream) chunks.push(chunk);
  const fileBuffer = Buffer.concat(chunks);

  const uploadRes = await fetch(uploadUrl, {
    method:  'PUT',
    headers: {
      'Content-Type':   mimeType,
      'Content-Length': String(fileSize),
    },
    body: fileBuffer,
  });

  const uploaded = await uploadRes.json();
  if (!uploaded.id) {
    throw new Error(`upload failed: ${JSON.stringify(uploaded)}`);
  }

  logger.info(MODULE, `video uploaded: ${uploaded.id}`);
  return uploaded.id;
}

// ── ヘルパー ─────────────────────────────────────────────────────────

function markUploaded(draftPath, draft, videoId) {
  fs.writeFileSync(draftPath, JSON.stringify({
    ...draft,
    status:     'uploaded',
    videoId,
    url:        `https://www.youtube.com/watch?v=${videoId}`,
    uploadedAt: new Date().toISOString(),
  }, null, 2));
}

function savePending(draftPath, draft, reason) {
  fs.writeFileSync(draftPath, JSON.stringify({
    ...draft,
    status:        'pending',
    pendingReason: reason,
    updatedAt:     new Date().toISOString(),
  }, null, 2));
  return { uploaded: false, reason };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [type, videoPath] = process.argv.slice(2);
  runUpload({ type: type ?? 'short', videoPath });
}
