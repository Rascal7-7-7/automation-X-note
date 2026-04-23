/**
 * fal.ai クライアント — Seedance 2.0 image-to-video
 *
 * Seedance 2.0 エンドポイント: bytedance/seedance-2.0/image-to-video
 * 認証: FAL_KEY 環境変数
 *
 * 公式: https://fal.ai/models/bytedance/seedance-2.0/image-to-video
 */
import { fal } from '@fal-ai/client';
import { logger } from './logger.js';

const MODULE = 'fal:seedance';

// FAL_KEY が設定されていれば認証を初期化
if (process.env.FAL_KEY) {
  fal.config({ credentials: process.env.FAL_KEY });
}

export function isFalAvailable() {
  return Boolean(process.env.FAL_KEY);
}

/**
 * Seedance 2.0 で画像→動画を生成する。
 *
 * @param {object} opts
 * @param {string}  opts.imageUrl      - 参照画像の URL（fal.ai にアップロード済みの URL）
 * @param {string}  opts.prompt        - モーションプロンプト（英語推奨）
 * @param {number}  [opts.duration=5]  - 動画長（秒）最大15
 * @param {string}  [opts.resolution='720p'] - '480p' or '720p'
 * @param {string}  [opts.aspectRatio='9:16'] - 縦型ショート用
 * @returns {Promise<string>} 生成された動画の URL
 */
export async function generateSeedanceVideo({ imageUrl, prompt, duration = 5, resolution = '720p', aspectRatio = '9:16', useFast = false, seed } = {}) {
  if (!isFalAvailable()) throw new Error('FAL_KEY not set');

  // Fast tier は 720p まで
  const resolvedResolution = useFast && resolution === '1080p' ? '720p' : resolution;
  const endpoint = useFast
    ? 'bytedance/seedance-2.0/fast/image-to-video'
    : 'bytedance/seedance-2.0/image-to-video';

  logger.info(MODULE, `submitting job [${useFast ? 'fast' : 'standard'}]: "${prompt.substring(0, 60)}..."`);

  const input = {
    image_url:      imageUrl,
    prompt,
    duration:       String(duration),  // API は文字列 enum ("5" not 5)
    resolution:     resolvedResolution,
    aspect_ratio:   aspectRatio,
    generate_audio: false,             // 独自 BGM を使用するため無効化
    ...(seed !== undefined ? { seed } : {}),
  };

  const result = await fal.subscribe(endpoint, {
    input,
    logs: false,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') {
        logger.info(MODULE, `queue: IN_PROGRESS (position: ${update.queue_position ?? '?'})`);
      }
    },
  });

  const videoUrl = result?.data?.video?.url;
  if (!videoUrl) throw new Error(`Seedance returned no video URL: ${JSON.stringify(result)}`);

  logger.info(MODULE, `video ready: ${videoUrl}`);
  return videoUrl;
}

/**
 * ローカルファイルを fal.ai ストレージにアップロードして URL を返す。
 *
 * @param {string} filePath - アップロードするローカルファイルパス
 * @returns {Promise<string>} fal.ai ストレージの URL
 */
export async function uploadToFal(filePath) {
  const { createReadStream, statSync } = await import('fs');
  const { basename } = await import('path');

  if (!isFalAvailable()) throw new Error('FAL_KEY not set');

  const stream = createReadStream(filePath);
  const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const file = new File([await streamToBuffer(stream)], basename(filePath), { type: mime });

  logger.info(MODULE, `uploading ${basename(filePath)} to fal storage...`);
  const url = await fal.storage.upload(file);
  logger.info(MODULE, `uploaded → ${url}`);
  return url;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
