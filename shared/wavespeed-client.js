/**
 * WaveSpeed AI クライアント — WAN 2.2 image-to-video
 *
 * エンドポイント: wavespeed-ai/wan-2.2/i2v-720p
 * 認証: WAVESPEED_API_KEY 環境変数
 * 料金: ~$0.01/動画（5秒）、サインアップ$1無料クレジット
 */
import fs from 'fs';
import { logger } from './logger.js';

const MODULE   = 'wavespeed:i2v';
const BASE_URL = 'https://api.wavespeed.ai/api/v3';
const MODEL    = 'wavespeed-ai/wan-2.2/i2v-720p';

export function isWaveSpeedAvailable() {
  return Boolean(process.env.WAVESPEED_API_KEY);
}

/**
 * WAN 2.2 で画像→動画を生成する。
 *
 * @param {object} opts
 * @param {string}  opts.imageUrl   - 公開 URL または base64 data URI
 * @param {string}  opts.prompt     - モーションプロンプト（英語）
 * @param {number}  [opts.duration=5] - 動画長（秒）
 * @returns {Promise<string>} 生成された動画の URL
 */
export async function generateWaveSpeedVideo({ imageUrl, prompt, duration = 5 }) {
  if (!isWaveSpeedAvailable()) throw new Error('WAVESPEED_API_KEY not set');

  const key = process.env.WAVESPEED_API_KEY;
  logger.info(MODULE, `submitting: "${prompt.substring(0, 60)}..."`);

  // Step 1: ジョブ送信
  const submitRes = await fetch(`${BASE_URL}/${MODEL}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      image:            imageUrl,
      prompt,
      negative_prompt:  'blur, distortion, ugly, deformed, low quality, watermark, text',
      duration:         String(duration),
      aspect_ratio:     '9:16',
      seed:             -1,
    }),
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`WaveSpeed submit failed (${submitRes.status}): ${err}`);
  }

  const { data: submitData } = await submitRes.json();
  const pollUrl = submitData?.urls?.get;
  if (!pollUrl) throw new Error(`No poll URL in response: ${JSON.stringify(submitData)}`);
  logger.info(MODULE, `job submitted: ${submitData.id}`);

  // Step 2: ポーリング（最大10分）
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5_000));

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!pollRes.ok) {
      logger.warn(MODULE, `poll error ${pollRes.status}, retrying...`);
      continue;
    }

    const { data: result } = await pollRes.json();
    logger.info(MODULE, `status: ${result.status}`);

    if (result.status === 'completed') {
      const url = result.outputs?.[0];
      if (!url) throw new Error(`No output URL: ${JSON.stringify(result)}`);
      logger.info(MODULE, `video ready: ${url}`);
      return url;
    }

    if (result.status === 'failed') {
      throw new Error(`WaveSpeed job failed: ${result.error ?? 'unknown'}`);
    }
  }

  throw new Error('WaveSpeed timeout after 10 minutes');
}

/**
 * ローカル PNG/JPEG を base64 data URI に変換。
 *
 * @param {string} filePath
 * @returns {string}
 */
export function imageToDataUri(filePath) {
  const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const b64  = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}
