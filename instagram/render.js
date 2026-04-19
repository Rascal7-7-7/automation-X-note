/**
 * Instagram Reels レンダリングモジュール
 *
 * 優先順位:
 *   1. HeyGen  (HEYGEN_API_KEY)  — 高品質アバター動画
 *   2. D-ID    (DID_API_KEY)     — 顔写真 + TTS アバター動画（安価）
 *   3. ffmpeg  (フォールバック)   — テキスト + 画像スライドショー（無料）
 *
 * 必要な環境変数:
 *   HEYGEN_API_KEY         - HeyGen（優先1）
 *   HEYGEN_AVATAR_ID       - HeyGenアバターID（省略可）
 *   HEYGEN_VOICE_ID_JA     - HeyGen日本語ボイスID（省略可）
 *   DID_API_KEY            - D-ID（優先2）"email:api_key" 形式
 *   DID_AVATAR_IMAGE_URL   - D-IDアバター顔写真URL（省略時: デフォルト女性）
 *   DID_VOICE_ID           - D-ID音声ID（省略時: ja-JP-NanamiNeural）
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';
import { isHeyGenAvailable, generateAvatarVideo, downloadVideo as heygenDownload, listVoices } from '../shared/heygen-client.js';
import { isDIDAvailable, generateTalkingVideo, downloadVideo as didDownload } from '../shared/did-client.js';

const execFileAsync = promisify(execFile);
const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR    = path.join(__dirname, 'drafts');
const MODULE        = 'instagram:render';

// ── メイン ──────────────────────────────────────────────────────────

export async function runRender({ account = 1, date } = {}) {
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

  const outDir = path.join(DRAFTS_DIR, `account${account}`, today);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    let result;

    if (isHeyGenAvailable()) {
      logger.info(MODULE, 'using HeyGen for Reels render');
      result = await renderWithHeyGen(draft, outDir);
    } else if (isDIDAvailable()) {
      logger.info(MODULE, 'using D-ID for Reels render');
      result = await renderWithDID(draft, outDir);
    } else {
      logger.info(MODULE, 'no avatar API configured — using ffmpeg slideshow fallback');
      result = await renderWithFFmpeg(draft, outDir);
    }

    const updated = { ...draft, ...result, reelsRenderedAt: new Date().toISOString() };
    fs.writeFileSync(draftPath, JSON.stringify(updated, null, 2));
    logger.info(MODULE, `Reels rendered → ${result.reelsVideoPath}`);
    return { rendered: true, ...result };

  } catch (err) {
    logger.error(MODULE, `Reels render error: ${err.message}`);
    return { rendered: false, reason: err.message };
  }
}

// ── HeyGen ──────────────────────────────────────────────────────────

async function renderWithHeyGen(draft, outDir) {
  const voiceId  = await resolveHeyGenVoice();
  const outPath  = path.join(outDir, 'reels_heygen.mp4');
  const { videoUrl } = await generateAvatarVideo({
    script:      draft.reelsScript,
    avatarId:    process.env.HEYGEN_AVATAR_ID ?? undefined,
    voiceId,
    aspectRatio: '9:16',
    resolution:  '1080p',
  });
  await heygenDownload(videoUrl, outPath);
  // HeyGenのURLは期限付きのためローカルパスのみ保存（Cloudinary等へのアップロードは別タスク）
  return { reelsVideoPath: outPath, reelsVideoUrl: videoUrl };
}

async function resolveHeyGenVoice() {
  if (process.env.HEYGEN_VOICE_ID_JA) return process.env.HEYGEN_VOICE_ID_JA;
  try {
    const voices = await listVoices('Japanese');
    const chosen = voices.find(v => v.gender?.toLowerCase() === 'female') ?? voices[0];
    if (chosen) {
      logger.info(MODULE, `HeyGen auto voice: ${chosen.name}`);
      return chosen.voice_id;
    }
  } catch { /* use default */ }
  return undefined;
}

// ── D-ID ────────────────────────────────────────────────────────────

async function renderWithDID(draft, outDir) {
  const outPath = path.join(outDir, 'reels_did.mp4');
  const { videoUrl } = await generateTalkingVideo({ script: draft.reelsScript });
  await didDownload(videoUrl, outPath);
  // D-IDのresult_urlはCDN上の公開URLなのでそのままInstagram APIに渡せる
  return { reelsVideoPath: outPath, reelsVideoUrl: videoUrl };
}

// ── ffmpeg スライドショー（フォールバック） ───────────────────────────

async function downloadImageToFile(url, destPath) {
  const https = await import('https');
  const http  = await import('http');
  const lib   = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, res => {
      if (res.statusCode !== 200) { reject(new Error(`download failed: ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { fs.writeFileSync(destPath, Buffer.concat(chunks)); resolve(destPath); });
    }).on('error', reject);
  });
}

async function renderWithFFmpeg(draft, outDir) {
  let imagePath = draft.imagePath;

  // imagePath未設定またはファイルなし → imageUrlからダウンロード
  if (!imagePath || !fs.existsSync(imagePath)) {
    if (!draft.imageUrl) {
      throw new Error('ffmpeg fallback requires draft.imagePath or imageUrl — run instagram:image first');
    }
    const ext      = path.extname(new URL(draft.imageUrl).pathname) || '.png';
    const tmpPath  = path.join(outDir, `_dl_image${ext}`);
    logger.info(MODULE, `imagePath missing, downloading from imageUrl → ${tmpPath}`);
    await downloadImageToFile(draft.imageUrl, tmpPath);
    imagePath = tmpPath;
  }

  const outPath  = path.join(outDir, 'reels_slideshow.mp4');
  const fontSize = 48;
  const text     = draft.reelsScript.replace(/['"\\:]/g, ' ').slice(0, 200);
  const duration = 20;

  // 画像 + テキストオーバーレイ → 縦型 9:16 動画
  const drawtext = `drawtext=text='${text}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=h*0.75:line_spacing=8:box=1:boxcolor=black@0.5:boxborderw=10`;

  await execFileAsync('ffmpeg', [
    '-y',
    '-loop', '1', '-i', imagePath,
    '-t', String(duration),
    '-vf', `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,${drawtext}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-r', '30',
    outPath,
  ]);

  return { reelsVideoPath: outPath, reelsVideoUrl: null };
}

// ── CLI ──────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [account, date] = process.argv.slice(2);
  runRender({ account: account ? Number(account) : 1, date });
}
