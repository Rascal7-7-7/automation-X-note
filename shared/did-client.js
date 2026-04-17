/**
 * D-ID API Client
 * 顔写真 + テキストスクリプト → 喋るアバター動画
 *
 * Required env:
 *   DID_API_KEY           - D-ID APIキー（Basic認証: base64(email:key)）
 *   DID_AVATAR_IMAGE_URL  - アバター顔写真のパブリックURL（省略時: D-IDデフォルトプレゼンター）
 *   DID_VOICE_ID          - 音声ID（省略時: ja-JP-NanamiNeural）
 *
 * Docs: https://docs.d-id.com/reference/createtalk
 */
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const MODULE   = 'did-client';
const BASE_URL = 'https://api.d-id.com';

// D-IDデフォルトのプレゼンター（APIキーなしでも使用可能なサンプル画像）
const DEFAULT_AVATAR_URL = 'https://d-id-public-bucket.s3.amazonaws.com/alice.jpg';
const DEFAULT_VOICE_ID   = 'ja-JP-NanamiNeural';

export function isDIDAvailable() {
  return Boolean(process.env.DID_API_KEY);
}

function getAuthHeader() {
  const key = process.env.DID_API_KEY;
  if (!key) throw new Error('DID_API_KEY is not set');
  // D-ID は Basic auth: base64("email:api_key") または Bearer token
  // キーが email:key 形式か否かで判定
  const encoded = key.includes(':') ? Buffer.from(key).toString('base64') : key;
  const scheme  = key.includes(':') ? 'Basic' : 'Bearer';
  return `${scheme} ${encoded}`;
}

async function request(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`D-ID API error ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * テキストスクリプトから喋るアバター動画を生成する
 * @param {object} params
 * @param {string} params.script   - 読み上げテキスト（日本語）
 * @param {string} [params.avatarImageUrl] - 顔写真 URL（省略時: デフォルト）
 * @param {string} [params.voiceId]        - Azure TTS voice ID（省略時: NanamiNeural）
 * @returns {Promise<{talkId: string, videoUrl: string, duration: number}>}
 */
export async function generateTalkingVideo({ script, avatarImageUrl, voiceId }) {
  const sourceUrl = avatarImageUrl ?? process.env.DID_AVATAR_IMAGE_URL ?? DEFAULT_AVATAR_URL;
  const voice     = voiceId ?? process.env.DID_VOICE_ID ?? DEFAULT_VOICE_ID;

  logger.info(MODULE, `creating talk: voice=${voice}, avatar=${sourceUrl.slice(0, 50)}...`);

  const body = {
    source_url: sourceUrl,
    script: {
      type:     'text',
      input:    script.trim(),
      provider: {
        type:     'microsoft',
        voice_id: voice,
      },
    },
    config: {
      fluent:        false,
      pad_audio:     0.0,
      result_format: 'mp4',
    },
  };

  const createRes = await request('/talks', { method: 'POST', body: JSON.stringify(body) });
  const talkId = createRes?.id;
  if (!talkId) throw new Error(`D-ID /talks response missing id: ${JSON.stringify(createRes)}`);

  logger.info(MODULE, `talk created id=${talkId} — polling...`);
  const videoUrl = await pollTalkCompletion(talkId);
  return { talkId, videoUrl, duration: null };
}

async function pollTalkCompletion(talkId, maxWaitMs = 300_000) {
  const started = Date.now();
  let interval  = 5_000;

  while (Date.now() - started < maxWaitMs) {
    await new Promise(r => setTimeout(r, interval));
    const res    = await request(`/talks/${talkId}`);
    const status = res?.status;

    logger.info(MODULE, `talk ${talkId} status: ${status}`);

    if (status === 'done') {
      const url = res?.result_url;
      if (!url) throw new Error(`D-ID talk done but result_url missing`);
      return url;
    }
    if (status === 'error') {
      throw new Error(`D-ID talk failed: ${res?.error?.description ?? JSON.stringify(res)}`);
    }

    if (Date.now() - started > 60_000) interval = 10_000;
  }

  throw new Error(`D-ID talk ${talkId} did not complete within ${maxWaitMs / 1000}s`);
}

/**
 * D-ID が返した動画 URL をローカルにダウンロードする
 */
export async function downloadVideo(videoUrl, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await pipeline(res.body, createWriteStream(outputPath));
  logger.info(MODULE, `video saved: ${outputPath}`);
}
