/**
 * Instagram Reels レンダリングモジュール
 *
 * フロー:
 *   1. instagram/drafts/account{N}/{date}/post.json を読み込む
 *   2-a. HEYGEN_API_KEY が設定されている場合:
 *        HeyGen v3 API で 9:16 アバター動画を生成（15〜30秒 Reels向け）
 *   2-b. 未設定の場合:
 *        HEYGEN_API_KEY が必要な旨を警告して終了
 *        （Reels動画は HeyGen 専用。静止画投稿は generate.js + post.js で対応）
 *   3. draft.reelsVideoPath に保存パスを書き込む
 *
 * 必要な環境変数:
 *   HEYGEN_API_KEY          - HeyGen アバター動画生成（必須）
 *   HEYGEN_AVATAR_ID        - 使用するアバター ID（省略時: アカウント内の最初のアバター）
 *   HEYGEN_VOICE_ID_JA      - 日本語ボイス ID（省略時: 日本語ボイスを自動選択）
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';
import {
  isHeyGenAvailable,
  generateAvatarVideo,
  downloadVideo,
  listVoices,
} from '../shared/heygen-client.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const MODULE     = 'instagram:render';

// ── メイン ──────────────────────────────────────────────────────────

/**
 * @param {object} [options]
 * @param {number} [options.account=1] - アカウント番号
 * @param {string} [options.date]      - YYYY-MM-DD（省略時: 今日）
 * @returns {Promise<{rendered: boolean, reelsVideoPath?: string, reason?: string}>}
 */
export async function runRender({ account = 1, date } = {}) {
  if (!isHeyGenAvailable()) {
    logger.warn(MODULE, 'HEYGEN_API_KEY is not set — Reels video rendering skipped');
    return { rendered: false, reason: 'HEYGEN_API_KEY not configured' };
  }

  const today     = date ?? new Date().toISOString().split('T')[0];
  const draftPath = path.join(DRAFTS_DIR, `account${account}`, today, 'post.json');

  if (!fs.existsSync(draftPath)) {
    logger.warn(MODULE, `draft not found: ${draftPath}`);
    return { rendered: false, reason: 'no draft' };
  }

  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

  if (draft.reelsVideoPath && fs.existsSync(draft.reelsVideoPath)) {
    logger.info(MODULE, 'Reels video already rendered, skipping');
    return { rendered: false, reason: 'already rendered' };
  }

  if (!draft.reelsScript) {
    logger.warn(MODULE, 'draft.reelsScript is empty; run instagram/generate.js first');
    return { rendered: false, reason: 'no reelsScript in draft' };
  }

  try {
    const outDir   = path.join(DRAFTS_DIR, `account${account}`, today);
    const outPath  = path.join(outDir, 'reels_heygen.mp4');

    logger.info(MODULE, `rendering Reels for account${account}: "${draft.theme}"...`);

    const voiceId = await resolveJapaneseVoiceId();

    const { videoUrl } = await generateAvatarVideo({
      script:      draft.reelsScript,
      avatarId:    process.env.HEYGEN_AVATAR_ID     ?? undefined,
      voiceId,
      aspectRatio: '9:16',
      resolution:  '1080p',
    });

    await downloadVideo(videoUrl, outPath);

    const updated = {
      ...draft,
      reelsVideoPath: outPath,
      reelsRenderedAt: new Date().toISOString(),
    };
    fs.writeFileSync(draftPath, JSON.stringify(updated, null, 2));

    logger.info(MODULE, `Reels rendered → ${outPath}`);
    return { rendered: true, reelsVideoPath: outPath };

  } catch (err) {
    logger.error(MODULE, `Reels render error: ${err.message}`);
    return { rendered: false, reason: err.message };
  }
}

// ── 日本語ボイス解決 ─────────────────────────────────────────────────

/**
 * 日本語ボイス ID を解決する。
 * 環境変数 HEYGEN_VOICE_ID_JA が設定されていればそれを使用し、
 * 未設定の場合は HeyGen API から女性日本語ボイスを自動選択する。
 * @returns {Promise<string|undefined>}
 */
async function resolveJapaneseVoiceId() {
  const envVoiceId = process.env.HEYGEN_VOICE_ID_JA;
  if (envVoiceId) {
    return envVoiceId;
  }

  logger.info(MODULE, 'HEYGEN_VOICE_ID_JA not set, fetching Japanese voices...');

  try {
    const voices = await listVoices('Japanese');
    if (voices.length === 0) {
      logger.warn(MODULE, 'No Japanese voices found, using avatar default voice');
      return undefined;
    }

    // 女性ボイスを優先
    const female = voices.find(v => v.gender?.toLowerCase() === 'female');
    const chosen = female ?? voices[0];

    logger.info(MODULE, `auto-selected voice: ${chosen.name} (${chosen.voice_id})`);
    return chosen.voice_id;
  } catch (err) {
    logger.warn(MODULE, `Failed to fetch voices: ${err.message} — using avatar default`);
    return undefined;
  }
}

// ── CLI 直接実行 ──────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [account, date] = process.argv.slice(2);
  runRender({ account: account ? Number(account) : 1, date });
}
