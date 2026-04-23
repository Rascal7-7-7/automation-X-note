/**
 * Replicate クライアント — WAN 2.1 image-to-video
 *
 * モデル: wan-ai/wan2.1-i2v-480p
 * 認証: REPLICATE_API_TOKEN 環境変数
 */
import Replicate from 'replicate';
import fs from 'fs';
import { logger } from './logger.js';

const MODULE = 'replicate:i2v';

let _client = null;

function getClient() {
  if (!_client) {
    _client = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  }
  return _client;
}

export function isReplicateAvailable() {
  return Boolean(process.env.REPLICATE_API_TOKEN);
}

/**
 * WAN 2.1 で画像→動画を生成する（wavespeedai/wan-2.1-i2v-480p）。
 *
 * @param {object} opts
 * @param {string}  opts.imageUrl        - 公開 URL または data URI（base64）
 * @param {string}  opts.prompt          - モーションプロンプト（英語推奨）
 * @param {number}  [opts.duration=5]    - 動画長（秒、参考値）
 * @param {number}  [opts.maxRetries=3]  - 429 時のリトライ回数
 * @returns {Promise<string>} 生成された動画の URL
 */
export async function generateReplicateVideo({ imageUrl, prompt, duration = 5, maxRetries = 3 }) {
  if (!isReplicateAvailable()) throw new Error('REPLICATE_API_TOKEN not set');

  logger.info(MODULE, `submitting: "${prompt.substring(0, 60)}..."`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const output = await getClient().run(
        'wavespeedai/wan-2.1-i2v-480p',
        {
          input: {
            image:           imageUrl,
            prompt,
            negative_prompt: 'blur, distortion, ugly, deformed, low quality, watermark, text',
            fast_mode:       'Balanced',
            sample_steps:    25,
            aspect_ratio:    '9:16',
          },
        }
      );

      // output は URL 文字列が標準
      if (typeof output === 'string') {
        logger.info(MODULE, `video ready: ${output}`);
        return output;
      }
      // FileOutput オブジェクト（url() メソッド持つ場合）
      if (output && typeof output.url === 'function') {
        const url = output.url().toString();
        logger.info(MODULE, `video ready: ${url}`);
        return url;
      }
      throw new Error(`Unexpected output: ${JSON.stringify(output)}`);

    } catch (err) {
      const is429 = err.message?.includes('429') || err.message?.includes('throttled');
      if (is429 && attempt < maxRetries) {
        const wait = (attempt + 1) * 15_000; // 15s, 30s, 45s
        logger.info(MODULE, `[429] rate limited, retry ${attempt + 1}/${maxRetries} in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('max retries exceeded');
}

/**
 * ローカル画像を Replicate の file upload API 経由でアップロードし URL を返す。
 * ※ Replicate は data URI も受け付けるため base64 で渡す。
 *
 * @param {string} filePath
 * @returns {Promise<string>} data URI（base64）
 */
export function imageToDataUri(filePath) {
  const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const b64  = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}
