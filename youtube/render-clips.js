/**
 * YouTube レンダリング — Seedance / ChatGPT / Anime パイプラインモジュール
 *
 * 抽出関数:
 *   generateStoryboardGrid, splitGridIntoFrames,
 *   generateSeedanceClips,
 *   concatClips,
 *   renderChatGPTShort (export),
 *   renderAnimeShort (export),
 *   generateAnimeSubtitleSRT
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../shared/logger.js';
import {
  isFalAvailable,
  generateSeedanceVideo,
  uploadToFal,
  generateBgmFromFal,
  buildBgmPrompt,
} from '../shared/fal-client.js';
import {
  isReplicateAvailable,
  generateReplicateVideo,
} from '../shared/replicate-client.js';
import {
  isWaveSpeedAvailable,
  generateWaveSpeedVideo,
  imageToDataUri,
} from '../shared/wavespeed-client.js';
import {
  generateKenBurnsClip,
  convertSRTtoASS,
  pickBgm,
  secondsToSrtTs,
  generateFallbackImage,
  CAPTION_PALETTES,
  STYLE,
  resolveStyleKey,
} from './render-ffmpeg.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODULE = 'youtube:render';

// ── OpenAI（gpt-image-2）lazy instantiation ──────────────────────────
let _openai = null;
async function getOpenAI() {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY2 ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: OpenAI } = await import('openai');
    _openai = new OpenAI({ apiKey });
    return _openai;
  } catch {
    logger.warn(MODULE, 'openai package not available — install it with: npm i openai');
    return null;
  }
}

// ── ChatGPT (gpt-image-2) × Seedance 2.0 ストーリーボードパイプライン ──────
//
// @onofumi_AI が公開したワークフロー（17.9万views）:
//   1. gpt-image-2 で「3×3グリッドのストーリーボード」を1枚生成
//   2. グリッドを9コマに分割（FFmpeg crop）
//   3. 各コマ → Seedance 2.0（fal.ai）でimage-to-video（3-5秒）
//   4. 全クリップを結合して YouTube Short 完成

/**
 * gpt-image-2 で 3×3 グリッドのストーリーボード画像を1枚生成する。
 *
 * @param {string} storyboardPrompt - コンテンツの内容説明
 * @param {string} stylePrompt      - 画風（英語）
 * @param {string} outDir           - 出力ディレクトリ
 * @returns {Promise<string>} グリッド画像の絶対パス
 */
async function generateStoryboardGrid(storyboardPrompt, stylePrompt, outDir) {
  const openai = await getOpenAI();
  const gridPath = path.join(outDir, 'storyboard_grid.png');

  if (fs.existsSync(gridPath)) {
    logger.info(MODULE, '[gpt-image-2] grid already exists, skip generation');
    return gridPath;
  }

  if (!openai) {
    logger.warn(MODULE, '[gpt-image-2] OpenAI unavailable — skipping grid generation');
    return null;
  }

  // @onofumi_AI の鉄板プロンプト形式: 「ストーリーボードを3×3のグリッド形式で作成。」+ 内容
  const prompt = [
    'Create a storyboard in 3x3 grid format.',
    storyboardPrompt,
    stylePrompt ? `Art style: ${stylePrompt}.` : '',
    'Each panel clearly separated. No text overlays. No panel numbers.',
    'Consistent character design across all 9 panels.',
  ].filter(Boolean).join(' ');

  // gpt-image-2 requires org verification — fall back to gpt-image-1 if denied
  const models = ['gpt-image-2', 'gpt-image-1'];
  let response, usedModel;

  for (const m of models) {
    try {
      logger.info(MODULE, `[gpt-image-2] generating 3x3 storyboard grid (model: ${m})...`);
      response = await openai.images.generate({
        model:          m,
        prompt,
        size:           '1024x1024',
        output_format:  'png',
        quality:        'high',
        n:              1,
      });
      usedModel = m;
      break;
    } catch (err) {
      if (err.status === 403 && m !== models[models.length - 1]) {
        logger.warn(MODULE, `[gpt-image-2] ${m} requires org verification, trying ${models[models.indexOf(m) + 1]}...`);
        continue;
      }
      throw err;
    }
  }

  logger.info(MODULE, `[gpt-image-2] grid generated with ${usedModel}`);
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${usedModel} returned no b64_json`);

  fs.writeFileSync(gridPath, Buffer.from(b64, 'base64'));
  logger.info(MODULE, `[gpt-image-2] grid saved → ${gridPath}`);
  return gridPath;
}

/**
 * 3×3 グリッド画像を 9 コマに分割して PNG ファイルとして保存する。
 *
 * @param {string} gridPath - グリッド画像パス（1024×1024）
 * @param {string} outDir   - 出力ディレクトリ
 * @returns {Promise<string[]>} 9 コマのパス配列（左上→右下の順）
 */
async function splitGridIntoFrames(gridPath, outDir) {
  // セルサイズ = 1024 / 3 ≒ 341px（端数は crop で吸収）
  const cellSize = Math.floor(1024 / 3);
  const framePaths = [];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx      = row * 3 + col;
      const framePath = path.join(outDir, `frame_${idx}.png`);

      if (!fs.existsSync(framePath)) {
        const x = col * cellSize;
        const y = row * cellSize;
        await execFileAsync('ffmpeg', [
          '-y', '-i', gridPath,
          '-vf', `crop=${cellSize}:${cellSize}:${x}:${y},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`,
          framePath,
        ], { timeout: 15000 });
      }

      framePaths.push(framePath);
    }
  }

  logger.info(MODULE, `[grid-split] 9 frames extracted → ${outDir}`);
  return framePaths;
}

/**
 * 各フレームを Seedance 2.0（fal.ai）で動画化し、クリップパスの配列を返す。
 * FAL_KEY 未設定の場合は Ken Burns フォールバック（静止画モーション）を使用する。
 *
 * @param {string[]} framePaths    - 9 コマの画像パス
 * @param {string[]} motionPrompts - 各コマのモーションプロンプト（英語）
 * @param {string}   outDir        - 出力ディレクトリ
 * @returns {Promise<string[]>} 9 クリップの mp4 パス
 */
async function generateSeedanceClips(framePaths, motionPrompts, outDir) {
  const clipPaths = [];

  for (let i = 0; i < framePaths.length; i++) {
    const clipPath = path.join(outDir, `clip_${i}.mp4`);

    if (fs.existsSync(clipPath)) {
      logger.info(MODULE, `[seedance] clip ${i} already exists, skip`);
      clipPaths.push(clipPath);
      continue;
    }

    const basePrompt = motionPrompts[i] ?? 'gentle camera movement, cinematic, smooth motion';
    const prompt     = `${basePrompt} Maintain exact appearance from reference image. Consistent character throughout, no deformation or style drift. Anatomically correct, 5 fingers per hand, no face distortion.`;

    let clipGenerated = false;

    // ── 1st try: FAL Seedance 2.0 ───────────────────────────────────
    if (isFalAvailable()) {
      try {
        logger.info(MODULE, `[seedance] clip ${i + 1}/${framePaths.length}...`);
        const falUrl   = await uploadToFal(framePaths[i]);
        const videoUrl = await generateSeedanceVideo({
          imageUrl:    falUrl,
          prompt,
          duration:    5,
          resolution:  '720p',
          aspectRatio: '9:16',
          useFast:     true,
        });
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        fs.writeFileSync(clipPath, Buffer.from(await res.arrayBuffer()));
        logger.info(MODULE, `[seedance] clip ${i} saved → ${clipPath}`);
        clipPaths.push(clipPath);
        clipGenerated = true;
      } catch (err) {
        logger.warn(MODULE, `[seedance] clip ${i} failed (${err.message}), trying Replicate...`);
      }
    }

    // ── 2nd try: WaveSpeed WAN 2.2 ──────────────────────────────────
    if (!clipGenerated && isWaveSpeedAvailable()) {
      try {
        logger.info(MODULE, `[wavespeed] clip ${i + 1}/${framePaths.length}...`);
        const dataUri  = imageToDataUri(framePaths[i]);
        const videoUrl = await generateWaveSpeedVideo({ imageUrl: dataUri, prompt, duration: 5 });
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        fs.writeFileSync(clipPath, Buffer.from(await res.arrayBuffer()));
        logger.info(MODULE, `[wavespeed] clip ${i} saved → ${clipPath}`);
        clipPaths.push(clipPath);
        clipGenerated = true;
      } catch (err) {
        logger.warn(MODULE, `[wavespeed] clip ${i} failed (${err.message}), trying Replicate...`);
      }
    }

    // ── 3rd try: Replicate WAN 2.1 ──────────────────────────────────
    if (!clipGenerated && isReplicateAvailable()) {
      try {
        logger.info(MODULE, `[replicate] clip ${i + 1}/${framePaths.length}...`);
        const dataUri  = imageToDataUri(framePaths[i]);
        const videoUrl = await generateReplicateVideo({ imageUrl: dataUri, prompt, duration: 5 });
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        fs.writeFileSync(clipPath, Buffer.from(await res.arrayBuffer()));
        logger.info(MODULE, `[replicate] clip ${i} saved → ${clipPath}`);
        clipPaths.push(clipPath);
        clipGenerated = true;
      } catch (err) {
        logger.warn(MODULE, `[replicate] clip ${i} failed (${err.message}), trying Ken Burns...`);
      }
    }

    // ── Ken Burns fallback ──────────────────────────────────────────
    if (!clipGenerated) {
      logger.warn(MODULE, `[i2v] no service available — Ken Burns fallback for clip ${i}`);
      clipPaths.push(await generateKenBurnsClip(framePaths[i], 5, 'short', clipPath, i));
    }
  }

  return clipPaths;
}

/**
 * 複数の動画クリップを FFmpeg で結合する。
 *
 * @param {string[]} clipPaths - 結合するクリップのパス（順序通り）
 * @param {string}   outPath   - 出力 mp4 パス
 * @returns {Promise<string>} outPath
 */
async function concatClips(clipPaths, outPath) {
  const listPath = outPath.replace('.mp4', '_concat.txt');
  const lines    = clipPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listPath, lines);

  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c:v', 'libx264', '-c:a', 'aac',
    '-movflags', '+faststart',
    outPath,
  ], { timeout: 120000 });

  fs.rmSync(listPath, { force: true });
  logger.info(MODULE, `[concat] ${clipPaths.length} clips → ${outPath}`);
  return outPath;
}

/**
 * chatgpt-short レンダーパス。
 *
 * フロー: gpt-image-2（3×3ストーリーボード）→ グリッド分割 → Seedance 2.0（各コマ動画化）→ FFmpeg結合
 *
 * @param {object} draft   - draft.json の内容
 * @param {string} type    - 'chatgpt-short'
 * @param {string} outDir  - 出力ディレクトリ
 * @param {string} outPath - 出力 mp4 パス
 * @returns {Promise<string>} 生成された mp4 の絶対パス
 */
export async function renderChatGPTShort(draft, type, outDir, outPath) {
  const storyboardPrompt = draft.storyboardPrompt ?? draft.theme ?? 'AI technology lifestyle scenes';
  const stylePrompt      = draft.stylePrompt ?? '';
  const frames           = Array.isArray(draft.frames) ? draft.frames : [];
  const motionPrompts    = frames.map(f => f.motionPrompt ?? 'gentle camera movement, cinematic');

  logger.info(MODULE, `[chatgpt-short] theme: "${storyboardPrompt}"`);

  // Step 1: 3×3グリッドストーリーボード生成
  let gridPath;
  try {
    gridPath = await generateStoryboardGrid(storyboardPrompt, stylePrompt, outDir);
  } catch (err) {
    logger.warn(MODULE, `[chatgpt-short] grid generation failed (${err.message})`);
    gridPath = null;
  }

  // Step 2: グリッド分割 または フォールバック（グリッド生成失敗時は個別フォールバック画像）
  let framePaths;
  if (gridPath) {
    framePaths = await splitGridIntoFrames(gridPath, outDir);
  } else {
    logger.warn(MODULE, '[chatgpt-short] using 9 fallback images');
    framePaths = await Promise.all(
      Array.from({ length: 9 }, (_, i) => generateFallbackImage(outDir, i, 'short'))
    );
  }

  // motionPrompts が足りない場合は汎用プロンプトで補完
  const resolvedMotions = framePaths.map((_, i) =>
    motionPrompts[i] ?? 'gentle zoom-in, smooth cinematic movement'
  );

  // Step 3: Seedance 2.0 で各コマを動画化
  const clipPaths = await generateSeedanceClips(framePaths, resolvedMotions, outDir);

  // Step 4: 全クリップを結合
  await concatClips(clipPaths, outPath);

  // Step 5: BGM をミックス（字幕・TTS なし — ビジュアルのみで成立させる）
  const bgmPath   = pickBgm();
  const finalPath = outPath.replace('.mp4', '_final.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', outPath,
    '-i', bgmPath,
    '-filter_complex', '[1:a]volume=0.15[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=3[aout]',
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-shortest',
    finalPath,
  ], { timeout: 120000 }).catch(() => {
    // BGMミックス失敗時はそのまま使用
    fs.copyFileSync(outPath, finalPath);
  });

  return finalPath;
}

// ── anime-short: グリッド → 単一 Seedance 15s + 字幕 + BGM ─────────────

/**
 * anime-short 専用レンダラー。
 * gpt-image-2 で 3×3 グリッドを生成し、Seedance 2.0 に 1 回だけ投げて
 * 15 秒のアニメ動画を得る。字幕 SRT を生成し ASS バーンイン + BGM ミックスして返す。
 *
 * コスト比較: 旧方式（9 クリップ×$0.42） → 約$3.78 / 新方式（1 クリップ 15s） → 約$1.26
 */
export async function renderAnimeShort(draft, outDir, outPath) {
  const storyboardPrompt = draft.storyboardPrompt ?? draft.theme ?? 'anime awakening scene';
  const stylePrompt      = draft.stylePrompt ?? '';
  const hookText         = draft.hookText ?? null;
  const frames           = Array.isArray(draft.frames) ? draft.frames : [];

  logger.info(MODULE, `[anime-short] theme: "${draft.theme}"`);

  // Step 1: 3×3 グリッド生成（gpt-image-2）
  let gridPath;
  try {
    gridPath = await generateStoryboardGrid(storyboardPrompt, stylePrompt, outDir);
  } catch (err) {
    throw new Error(`[anime-short] grid generation failed: ${err.message}`);
  }

  // Step 2: グリッド → 15 秒アニメ動画（Seedance 2.0 シングルコール）
  const rawVideoPath = path.join(outDir, 'anime-short_raw.mp4');
  let videoReady = false;

  if (!fs.existsSync(rawVideoPath)) {
    if (isFalAvailable()) {
      try {
        logger.info(MODULE, '[anime-short] uploading grid to FAL...');
        const gridUrl = await uploadToFal(gridPath);
        // draft.frames の motionPrompt を各パネルの指示として連結
        // Seedance best practice: 具体的なカメラ指示を明示、ただし過長は幻覚を増やすため先頭節のみ使用
        const panelInstructions = frames.length > 0
          ? frames.map((f, i) => {
              const motion = (f.motionPrompt ?? 'gentle camera movement').split(',')[0].trim();
              return `Panel ${i + 1}: ${motion}`;
            }).join('. ')
          : 'sequential camera movements, dynamic angles';
        const prompt = `Anime cinematic short film. @image1 is a 3x3 storyboard. Animate panels left-to-right top-to-bottom as sequential scenes. ${panelInstructions}. Cel-shading style, consistent character throughout, no style drift.`;
        logger.info(MODULE, '[anime-short] calling Seedance 2.0 (single 15 s)...');
        const videoUrl = await generateSeedanceVideo({
          imageUrl:    gridUrl,
          prompt,
          duration:    15,
          resolution:  '720p',
          aspectRatio: '9:16',
          useFast:     false,
        });
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        fs.writeFileSync(rawVideoPath, Buffer.from(await res.arrayBuffer()));
        logger.info(MODULE, `[anime-short] raw video saved → ${rawVideoPath}`);
        videoReady = true;
      } catch (err) {
        logger.warn(MODULE, `[anime-short] Seedance failed: ${err.message} — falling back to Ken Burns`);
      }
    }

    if (!videoReady) {
      // フォールバック: グリッド分割 → Ken Burns スライドショー
      const framePaths = await splitGridIntoFrames(gridPath, outDir);
      const clips      = await Promise.all(
        framePaths.map((fp, i) =>
          generateKenBurnsClip(fp, 15 / framePaths.length, 'short', path.join(outDir, `kb_${i}.mp4`), i)
        )
      );
      await concatClips(clips, rawVideoPath);
      videoReady = true;
    }
  } else {
    logger.info(MODULE, `[anime-short] raw video exists, reusing → ${rawVideoPath}`);
    videoReady = true;
  }

  // Step 3: 日本語字幕 SRT 生成
  const srtPath = path.join(outDir, 'anime-short.srt');
  generateAnimeSubtitleSRT(draft, srtPath, 15);

  // Step 4: SRT → ASS
  const assPath    = path.join(outDir, 'anime-short.ass');
  const paletteIdx = Math.floor(Math.random() * CAPTION_PALETTES.length);
  convertSRTtoASS(srtPath, 'short', assPath, paletteIdx, hookText, { subtle: true });

  // Step 5: FAL Stable Audio で テーマ連動 BGM 生成（キャッシュあり）
  const bgmCachePath = path.join(outDir, 'anime-short_bgm.wav');
  let bgmPath = null;
  if (!fs.existsSync(bgmCachePath)) {
    try {
      const bgmPrompt = buildBgmPrompt(draft);
      bgmPath = await generateBgmFromFal(bgmPrompt, bgmCachePath, 15);
    } catch (err) {
      logger.warn(MODULE, `[anime-short] BGM generation failed (${err.message}) — using local fallback`);
      bgmPath = pickBgm();
    }
  } else {
    logger.info(MODULE, `[anime-short] BGM cache exists, reusing → ${bgmCachePath}`);
    bgmPath = bgmCachePath;
  }

  const finalPath = outPath.replace('.mp4', '_final.mp4');

  const assEscaped   = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  // fontsdir 指定なし → libass がシステムフォント（ヒラギノ）を自動検出
  const vfFilter     = `ass='${assEscaped}'`;

  try {
    if (bgmPath) {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',           rawVideoPath,
        '-stream_loop', '-1', '-i', bgmPath,
        '-filter_complex',
          `[0:v]${vfFilter}[vout];[1:a]volume=0.20,atrim=duration=15[aout]`,
        '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-shortest',
        finalPath,
      ], { timeout: 180000 });
    } else {
      // BGM なし（ファイル不在時）
      await execFileAsync('ffmpeg', [
        '-y', '-i', rawVideoPath,
        '-vf', vfFilter,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'copy',
        finalPath,
      ], { timeout: 180000 });
    }
  } catch (err) {
    logger.warn(MODULE, `[anime-short] subtitle/BGM pass failed (${err.message}) — using raw video`);
    fs.copyFileSync(rawVideoPath, finalPath);
  }

  logger.info(MODULE, `[anime-short] final → ${finalPath}`);
  return finalPath;
}

/**
 * anime-short 用 SRT を生成する。
 * hookText を冒頭に置き、3 幕構成（導入・覚醒・続きへ）で 15 秒を埋める。
 */
function generateAnimeSubtitleSRT(draft, srtPath, durationSec = 15) {
  const hookText = draft.hookText ?? draft.theme ?? '';

  // hookText は convertSRTtoASS に渡すと CardHook（中央大テロップ 0〜2.5s）になる
  // SRT ダイアログは 3.0s 以降を担当
  // hookText は convertSRTtoASS の CardHook（中央大テロップ）で表示済み
  // SRT は 5.5s 以降の補助字幕のみ担当
  const cards = [
    { text: '力が覚醒する瞬間', start: 5.5,  end: 9.5  },
    { text: '続く…',           start: 12.5, end: durationSec - 0.1 },
  ];

  const entries = cards.map((c, i) =>
    `${i + 1}\n${secondsToSrtTs(c.start)} --> ${secondsToSrtTs(c.end)}\n${c.text}`
  );

  fs.writeFileSync(srtPath, entries.join('\n\n') + '\n', 'utf8');
  logger.info(MODULE, `[anime-short] SRT written (${cards.length} cards) → ${srtPath}`);
  return srtPath;
}
