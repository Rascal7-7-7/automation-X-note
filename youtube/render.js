/**
 * YouTube 動画レンダリングモジュール
 *
 * フロー（HeyGen優先）:
 *   1. youtube/drafts/{date}/{type}.json を読み込む
 *   2-a. HEYGEN_API_KEY が設定されている場合:
 *        HeyGen v3 API でアバター動画を生成して video_heygen.mp4 に保存
 *   2-b. 未設定の場合（フォールバック）:
 *        Gemini imagen-4.0-generate-001 でシーン背景画像を生成
 *        FFmpeg で画像 + テロップ + BGM を合成して mp4 を出力
 *   3. draft.videoPath に保存パスを書き込む
 *
 * 必要な環境変数:
 *   HEYGEN_API_KEY  - HeyGen アバター動画生成（優先）
 *   GEMINI_API_KEY  - Gemini Imagen フォールバック用
 *
 * 必要なツール（フォールバック時のみ）:
 *   ffmpeg（apt install ffmpeg）
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../shared/logger.js';
import {
  isHeyGenAvailable,
  generateAvatarVideo,
  downloadVideo,
} from '../shared/heygen-client.js';

const execFileAsync = promisify(execFile);

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR  = path.join(__dirname, 'drafts');
const ASSETS_DIR  = path.join(__dirname, 'assets');
const BGM_DIR     = path.join(ASSETS_DIR, 'bgm');
const FONTS_DIR   = path.join(ASSETS_DIR, 'fonts');

const MODULE = 'youtube:render';

// ── テロップ設定 ──────────────────────────────────────────────────
const STYLE = {
  short: {
    width: 1080, height: 1920,  // 9:16
    fontSize: 72,
    fontColor: 'white',
    bgColor: '0x000000@0.6',
    lineSpacing: 20,
    margin: 60,
  },
  long: {
    width: 1920, height: 1080,  // 16:9
    fontSize: 56,
    fontColor: 'white',
    bgColor: '0x000000@0.5',
    lineSpacing: 16,
    margin: 80,
  },
};

// 'reddit-short' など派生タイプを short/long に正規化
function resolveStyleKey(type) {
  if (STYLE[type]) return type;
  if (type.includes('long')) return 'long';
  return 'short';
}

// ── メイン ──────────────────────────────────────────────────────────

export async function runRender({ type = 'short', date } = {}) {
  const today     = date ?? new Date().toISOString().split('T')[0];
  const draftPath = path.join(DRAFTS_DIR, today, `${type}.json`);

  if (!fs.existsSync(draftPath)) {
    logger.warn(MODULE, `draft not found: ${draftPath}`);
    return { rendered: false, reason: 'no draft' };
  }

  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

  if (draft.status === 'uploaded') {
    logger.info(MODULE, 'already uploaded, skip render');
    return { rendered: false, reason: 'already uploaded' };
  }

  const outDir  = path.join(DRAFTS_DIR, today);
  const outPath = path.join(outDir, `${type}.mp4`);

  try {
    logger.info(MODULE, `rendering ${type} for "${draft.theme}"...`);

    let videoPath;

    if (isHeyGenAvailable()) {
      // ── HeyGen アバター動画生成パス ──────────────────────────
      videoPath = await renderWithHeyGen(draft, type, outDir);
    } else {
      // ── FFmpeg / Nanobanana フォールバックパス ────────────────
      logger.info(MODULE, 'HEYGEN_API_KEY not set, falling back to FFmpeg/Nanobanana');

      const scenes     = parseScenes(draft.script, type);
      const imagePaths = await generateSceneImages(scenes, outDir, type);
      const bgmPath    = pickBgm();
      const ttsPath    = await generateTTS(scenes, outDir);

      const { captionsPath } = await assembleVideo({ type, scenes, imagePaths, bgmPath, ttsPath, outPath });
      videoPath = outPath;
      if (captionsPath) draft._captionsPath = captionsPath;
    }

    // draft を更新
    const updated = {
      ...draft,
      videoPath,
      captionsPath: draft._captionsPath ?? null,
      status:     'rendered',
      renderedAt: new Date().toISOString(),
    };
    delete updated._captionsPath;
    fs.writeFileSync(draftPath, JSON.stringify(updated, null, 2));

    logger.info(MODULE, `rendered → ${videoPath}`);
    return { rendered: true, videoPath };

  } catch (err) {
    logger.error(MODULE, `render error: ${err.message}`);
    return { rendered: false, reason: err.message };
  }
}

// ── HeyGen アバター動画生成 ─────────────────────────────────────────

/**
 * HeyGen v3 API でアバター動画を生成してローカルに保存する。
 * @param {object} draft - draft.json の内容
 * @param {'short'|'long'} type - 動画タイプ
 * @param {string} outDir - 出力ディレクトリ（絶対パス）
 * @returns {Promise<string>} 保存した mp4 ファイルの絶対パス
 */
async function renderWithHeyGen(draft, type, outDir) {
  if (!draft.script) {
    throw new Error('draft.script is empty; cannot generate HeyGen video without a script');
  }

  const aspectRatio = type === 'short' ? '9:16' : '16:9';
  const outPath     = path.join(outDir, `video_heygen.mp4`);

  logger.info(MODULE, `[HeyGen] generating ${aspectRatio} avatar video...`);

  const { videoUrl } = await generateAvatarVideo({
    script:      draft.script,
    avatarId:    process.env.HEYGEN_AVATAR_ID  ?? undefined,
    voiceId:     process.env.HEYGEN_VOICE_ID   ?? undefined,
    aspectRatio,
    resolution:  '1080p',
  });

  await downloadVideo(videoUrl, outPath);

  logger.info(MODULE, `[HeyGen] video saved → ${outPath}`);
  return outPath;
}

// ── シーン分割 ──────────────────────────────────────────────────────

function parseScenes(script, type) {
  const fmt = resolveStyleKey(type); // 'short' or 'long'
  if (!script) return [{ text: 'AI副業ハック', duration: fmt === 'short' ? 10 : 30 }];

  const lines = script
    .split('\n')
    .map(l => l.trim())
    // セクションラベル・区切り線を除去
    .filter(l => l.length > 0)
    .filter(l => !/^[-─=*]{2,}$/.test(l))             // --- === *** などの区切り線
    .filter(l => !/^\[.*\]$/.test(l))                  // [HOOK] [BODY] などのラベル行
    .filter(l => !/^【[^】]*】$/.test(l))              // 【冒頭フック】などのラベル行のみの行
    .filter(l => !/^#+\s/.test(l))                     // ## 見出し
    .filter(l => !/^\/\//.test(l))                     // // コメント
    // マークダウン記法を除去
    .map(l => l.replace(/\*\*(.*?)\*\*/g, '$1'))       // **太字** → 太字
    .map(l => l.replace(/\*(.*?)\*/g, '$1'))            // *斜体* → 斜体
    .map(l => l.replace(/`(.*?)`/g, '$1'))              // `code` → code
    .map(l => l.replace(/\[([^\]]+)\]\s*/g, ''))        // [ラベル] を行頭から除去
    .map(l => l.replace(/【([^】]+)】\s*/g, ''))        // 【ラベル】を行頭から除去
    .map(l => l.replace(/^\d+\.\s+/, ''))               // 1. リスト番号
    .map(l => l.replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')) // ①② → 除去
    .map(l => l.replace(/^[-・•]\s*/, ''))              // - ・ • リスト記号
    .map(l => l.trim())
    .filter(l => l.length >= 8);                       // 短すぎる残骸を除去

  if (fmt === 'short') {
    // ショート: 合計40秒（5シーン×8秒）、テロップ1行40文字上限
    return lines.slice(0, 5).map(text => ({
      text: text.slice(0, 40),
      duration: 8,
    }));
  } else {
    // ロング: 60文字でまとめて各25秒のシーンに
    const scenes = [];
    let buffer = '';
    for (const line of lines) {
      if (buffer && buffer.length + line.length > 60) {
        scenes.push({ text: buffer.trim().slice(0, 60), duration: 25 });
        buffer = line;
      } else {
        buffer = buffer ? `${buffer} ${line}` : line;
      }
      if (scenes.length >= 20) break;
    }
    if (buffer && scenes.length < 20) {
      scenes.push({ text: buffer.trim().slice(0, 60), duration: 25 });
    }
    return scenes.length > 0 ? scenes : [{ text: 'AI副業ハック', duration: 30 }];
  }
}

// ── Gemini Imagen で画像生成 ───────────────────────────────────────

async function generateSceneImages(scenes, outDir, type) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    logger.warn(MODULE, 'GEMINI_API_KEY not set, using fallback gradient images');
    return Promise.all(scenes.map((_, i) => generateFallbackImage(outDir, i, type)));
  }

  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const paths = [];

  for (let i = 0; i < scenes.length; i++) {
    const imgPath = path.join(outDir, `scene_${i}.png`);
    if (fs.existsSync(imgPath)) {
      paths.push(imgPath);
      continue;
    }

    const prompt = buildImagePrompt(scenes[i].text, type);
    try {
      const result = await ai.models.generateImages({
        model:  'imagen-4.0-generate-001',
        prompt,
        config: { numberOfImages: 1, outputMimeType: 'image/png' },
      });

      const imageBytes = result.generatedImages?.[0]?.image?.imageBytes;
      if (!imageBytes) throw new Error('no image bytes returned');

      fs.writeFileSync(imgPath, Buffer.from(imageBytes, 'base64'));
      paths.push(imgPath);
      logger.info(MODULE, `scene image ${i + 1}/${scenes.length} generated`);
    } catch (err) {
      logger.warn(MODULE, `scene ${i} image failed, using fallback: ${err.message}`);
      paths.push(await generateFallbackImage(outDir, i, type));
    }
  }

  return paths;
}

function buildImagePrompt(text, type) {
  const ratio = type === 'short' ? 'vertical 9:16 portrait' : 'horizontal 16:9 landscape';
  const styles = [
    'vibrant purple and blue gradient, glowing neon lines, futuristic tech aesthetic',
    'deep space background, colorful nebula, purple and cyan glow, cinematic',
    'abstract digital waves, bright orange and magenta gradient, modern design',
    'glowing golden circuit board pattern, dark background, premium tech look',
    'electric blue and violet energy burst, dynamic abstract background',
  ];
  const style = styles[Math.abs(text.charCodeAt(0) ?? 0) % styles.length];
  return (
    `YouTube Shorts background image, ${ratio}, ${style}, ` +
    `no text, no people, no faces, no logos, ` +
    `high quality, 4K, professional video background, ` +
    `theme: ${text.slice(0, 40)}`
  );
}

async function generateFallbackImage(outDir, index, type) {
  const s = STYLE[resolveStyleKey(type)];
  const imgPath = path.join(outDir, `fallback_${index}.png`);

  // グラデーションパターン（シーンごとに変化）
  const gradients = [
    { from: '0x1a1a2e', to: '0x0f3460' },
    { from: '0x0f3460', to: '0x533483' },
    { from: '0x16213e', to: '0x2d6a4f' },
    { from: '0x533483', to: '0x1a1a2e' },
    { from: '0x2d6a4f', to: '0x16213e' },
  ];
  const g = gradients[index % gradients.length];

  // FFmpeg geq フィルターで上下グラデーション生成
  const r1 = parseInt(g.from.slice(2, 4), 16);
  const g1 = parseInt(g.from.slice(4, 6), 16);
  const b1 = parseInt(g.from.slice(6, 8), 16);
  const r2 = parseInt(g.to.slice(2, 4), 16);
  const g2 = parseInt(g.to.slice(4, 6), 16);
  const b2 = parseInt(g.to.slice(6, 8), 16);

  const geq = [
    `r='${r1}+(${r2}-${r1})*Y/H'`,
    `g='${g1}+(${g2}-${g1})*Y/H'`,
    `b='${b1}+(${b2}-${b1})*Y/H'`,
  ].join(':');

  await execFileAsync('ffmpeg', [
    '-y', '-f', 'lavfi',
    '-i', `color=black:size=${s.width}x${s.height}:rate=1`,
    '-vframes', '1',
    '-vf', `geq=${geq}`,
    imgPath,
  ]);

  return imgPath;
}

// ── TTS 音声生成（edge-tts） ─────────────────────────────────────────

async function generateTTS(scenes, outDir) {
  const ttsPath = path.join(outDir, 'tts.mp3');
  if (fs.existsSync(ttsPath)) return ttsPath;

  // シーンテキストを読点で繋いでナチュラルな間を作る
  const text = scenes.map(s => s.text).join('。');

  try {
    await execFileAsync('edge-tts', [
      '--text',        text,
      '--voice',       'ja-JP-NanamiNeural',
      '--rate',        '+5%',
      '--write-media', ttsPath,
    ]);
    logger.info(MODULE, `TTS generated → ${ttsPath}`);
    return ttsPath;
  } catch (err) {
    logger.warn(MODULE, `TTS generation failed: ${err.message}`);
    return null;
  }
}

// ── Ken Burns エフェクト付きクリップ生成 ─────────────────────────────────

async function generateKenBurnsClip(imgPath, duration, type, outPath, effectIdx) {
  const s      = STYLE[resolveStyleKey(type)];
  const fps    = 30;
  const frames = Math.round(duration * fps);
  // ズーム余裕1.2倍にスケールアップ→クロップして zoompan に渡す
  const W1 = Math.round(s.width  * 1.2);
  const H1 = Math.round(s.height * 1.2);
  const scaleCrop = `scale=${W1}:${H1}:force_original_aspect_ratio=increase,crop=${W1}:${H1}`;

  const effects = [
    // ズームイン（中央）
    `${scaleCrop},zoompan=z='1+0.1*(on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps}`,
    // 右パン（固定ズーム）
    `${scaleCrop},zoompan=z='1.08':x='iw*0.07*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps}`,
    // ズームアウト（中央）
    `${scaleCrop},zoompan=z='max(1.1-0.1*(on/${frames}),1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps}`,
  ];

  await execFileAsync('ffmpeg', [
    '-y', '-loop', '1', '-t', String(duration + 0.1),
    '-i', imgPath,
    '-vf', effects[effectIdx % effects.length],
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-t', String(duration),
    outPath,
  ], { timeout: 180000 });

  return outPath;
}

// ── FFmpeg 動画合成 ──────────────────────────────────────────────────

async function assembleVideo({ type, scenes, imagePaths, bgmPath, ttsPath, outPath }) {
  const s = STYLE[resolveStyleKey(type)];
  const totalDuration = scenes.reduce((sum, sc) => sum + sc.duration, 0);
  const outDir = path.dirname(outPath);

  const hasBgm = bgmPath && fs.existsSync(bgmPath);
  const hasTts = ttsPath && fs.existsSync(ttsPath);

  // ── Ken Burns クリップ生成 ──────────────────────────────────────────
  const clipPaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const clipPath = path.join(outDir, `kb_clip_${i}.mp4`);
    await generateKenBurnsClip(imagePaths[i], scenes[i].duration, type, clipPath, i);
    clipPaths.push(clipPath);
    logger.info(MODULE, `Ken Burns clip ${i + 1}/${scenes.length} done`);
  }

  // ── Pass 1: クリップ結合 + 音声合成（字幕なし） ────────────────────────
  const nosubPath = outPath.replace('.mp4', '_nosub.mp4');
  const listPath  = outPath.replace('.mp4', '_concat.txt');

  fs.writeFileSync(listPath, clipPaths.map(p => `file '${p}'`).join('\n'));

  const ffmpegArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath];

  if (hasBgm) ffmpegArgs.push('-stream_loop', '-1', '-i', bgmPath);
  if (hasTts) ffmpegArgs.push('-i', ttsPath);

  if (hasTts && hasBgm) {
    const fadeStart = Math.max(0, totalDuration - 2);
    ffmpegArgs.push(
      '-filter_complex',
      `[2:a]apad=whole_dur=${totalDuration}[ttspad];` +
      `[1:a]volume=0.12[bgm];` +
      `[ttspad][bgm]amix=inputs=2:duration=first:normalize=0,` +
      `afade=t=out:st=${fadeStart}:d=2[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    );
  } else if (hasTts) {
    ffmpegArgs.push(
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-shortest',
    );
  } else if (hasBgm) {
    const fadeStart = Math.max(0, totalDuration - 2);
    ffmpegArgs.push(
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-af', `afade=t=out:st=${fadeStart}:d=2`,
      '-shortest',
    );
  } else {
    ffmpegArgs.push('-c:v', 'copy', '-an');
  }

  ffmpegArgs.push('-t', String(totalDuration), nosubPath);

  await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 300000 });
  fs.unlinkSync(listPath);
  for (const cp of clipPaths) fs.rmSync(cp, { force: true });

  // ── 字幕生成（Whisper 優先 → シーンベースフォールバック） ────────────
  const captionsPath = outPath.replace('.mp4', '_captions.srt'); // 永続保持・upload.js が YouTube 字幕として使用
  const assPath      = outPath.replace('.mp4', '_subs.ass');

  let resolvedAssPath = null;
  try {
    const lang = process.env.YOUTUBE_SUBTITLE_LANG ?? 'ja';

    // Whisper で精度の高い字幕生成を試みる（日本語は文字分割の精度問題があるためスキップ）
    let srtResult = null;
    if (hasTts && lang !== 'ja') {
      srtResult = await generateSRTWithWhisper(ttsPath, captionsPath, lang);
    }

    // Whisper が使えない / TTS なし → シーンテキストからタイムスタンプ計算
    if (!srtResult) {
      logger.info(MODULE, 'Falling back to scene-based SRT generation');
      generateSRTFromScenes(scenes, captionsPath);
    }

    convertSRTtoASS(captionsPath, type, assPath);
    resolvedAssPath = assPath;
  } catch (err) {
    logger.warn(MODULE, `Subtitle generation failed, skipping: ${err.message}`);
  }

  // ── Pass 2: 字幕焼き込み ──────────────────────────────────────────
  const pass2Args = ['-y', '-i', nosubPath];

  if (resolvedAssPath && fs.existsSync(resolvedAssPath)) {
    const assEscaped   = resolvedAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const fontsEscaped = FONTS_DIR.replace(/\\/g, '/').replace(/:/g, '\\:');
    pass2Args.push(
      '-vf', `ass='${assEscaped}':fontsdir='${fontsEscaped}'`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    );
    logger.info(MODULE, 'Burning ASS subtitles into video');
  } else {
    pass2Args.push('-c:v', 'copy');
    logger.info(MODULE, 'No subtitles — copying video stream');
  }

  pass2Args.push('-c:a', 'copy', outPath);

  try {
    await execFileAsync('ffmpeg', pass2Args, { timeout: 300000 });
  } catch (err) {
    logger.warn(MODULE, `Subtitle burn-in failed, using no-subtitle video: ${err.message}`);
    fs.copyFileSync(nosubPath, outPath);
  }

  // 中間ファイルを削除（captionsPath は upload.js のために保持）
  for (const tmp of [nosubPath, assPath]) {
    fs.rmSync(tmp, { force: true });
  }

  return { captionsPath: fs.existsSync(captionsPath) ? captionsPath : null };
}

// ── 字幕生成（SRT / ASS） ────────────────────────────────────────────

/**
 * 秒数を SRT タイムスタンプ形式 HH:MM:SS,mmm に変換する。
 * @param {number} seconds
 * @returns {string}
 */
function secondsToSrtTs(seconds) {
  const h   = Math.floor(seconds / 3600);
  const m   = Math.floor((seconds % 3600) / 60);
  const s   = Math.floor(seconds % 60);
  const ms  = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * シーンのテキストとタイムスタンプから SRT ファイルを生成する（フォールバック方式）。
 * Whisper が使えない場合やオフライン環境でも動作する。
 *
 * @param {Array<{text: string, duration: number}>} scenes
 * @param {string} srtPath - 書き出し先の .srt ファイルパス
 * @returns {string} srtPath
 */
function generateSRTFromScenes(scenes, srtPath) {
  const entries = [];
  let idx     = 1;
  let elapsed = 0;
  const GAP   = 0.05; // カード間のギャップ（秒）
  const lang  = process.env.YOUTUBE_SUBTITLE_LANG ?? 'ja';

  for (const scene of scenes) {
    if (!scene.text) { elapsed += scene.duration; continue; }

    if (lang === 'ja') {
      // 日本語: スペースがないため1シーン全体を1枚のカードとして表示
      const start = elapsed;
      const end   = elapsed + scene.duration - GAP;
      entries.push(`${idx}\n${secondsToSrtTs(start)} --> ${secondsToSrtTs(end)}\n${scene.text}\n`);
      idx++;
      elapsed += scene.duration;
    } else {
      // 英語等: 最大 7 語ずつのカードに分割
      const words  = scene.text.split(/\s+/).filter(Boolean);
      const chunks = [];
      for (let i = 0; i < words.length; i += 7) chunks.push(words.slice(i, i + 7));
      if (chunks.length === 0) { elapsed += scene.duration; continue; }

      const secPerWord = scene.duration / Math.max(words.length, 1);
      for (const chunk of chunks) {
        const duration = chunk.length * secPerWord;
        const start    = elapsed;
        const end      = Math.min(elapsed + duration - GAP, elapsed + scene.duration - GAP);
        entries.push(`${idx}\n${secondsToSrtTs(start)} --> ${secondsToSrtTs(end)}\n${chunk.join(' ')}\n`);
        idx++;
        elapsed += duration;
      }
      // シーン終端まで elapsed を揃える
      const sceneEnd = elapsed;
      if (elapsed < sceneEnd) elapsed = sceneEnd;
    }
  }

  fs.writeFileSync(srtPath, entries.join('\n'), 'utf8');
  logger.info(MODULE, `SRT generated (scene-based, ${entries.length} cards) → ${srtPath}`);
  return srtPath;
}

/**
 * Whisper（Python）で TTS 音声を書き起こし、単語レベルタイムスタンプ付き SRT を生成する。
 * openai-whisper が pip でインストール済みの場合のみ動作する。
 * 失敗した場合は null を返す（呼び出し元でフォールバック）。
 *
 * @param {string} ttsPath - TTS 音声ファイルパス（mp3/wav）
 * @param {string} srtPath - 書き出し先の .srt ファイルパス
 * @param {string} lang    - 言語コード（例: 'ja', 'en'）
 * @returns {Promise<string|null>} srtPath or null on failure
 */
async function generateSRTWithWhisper(ttsPath, srtPath, lang = 'ja') {
  // Python インラインスクリプトで Whisper を実行し SRT を stdout に出力する
  const pyScript = `
import sys, json, re
try:
    import whisper
except ImportError:
    print("WHISPER_NOT_AVAILABLE", flush=True)
    sys.exit(1)

audio_path = sys.argv[1]
lang       = sys.argv[2] if len(sys.argv) > 2 else 'ja'
words_per_card = 3

model  = whisper.load_model("base")
result = model.transcribe(audio_path, language=lang, word_timestamps=True)

words = []
for seg in result.get("segments", []):
    for w in seg.get("words", []):
        words.append({"word": w["word"].strip(), "start": float(w["start"]), "end": float(w["end"])})

if not words:
    print("NO_WORDS", flush=True)
    sys.exit(2)

def to_srt_ts(s):
    h  = int(s // 3600)
    m  = int((s % 3600) // 60)
    sc = int(s % 60)
    ms = int((s % 1) * 1000)
    return f"{h:02d}:{m:02d}:{sc:02d},{ms:03d}"

entries = []
for i in range(0, len(words), words_per_card):
    card   = words[i:i+words_per_card]
    start  = card[0]["start"]
    end    = card[-1]["end"]
    text   = " ".join(w["word"] for w in card)
    n      = i // words_per_card + 1
    entries.append(f"{n}\\n{to_srt_ts(start)} --> {to_srt_ts(end)}\\n{text}\\n")

print("\\n".join(entries), end="", flush=True)
`.trim();

  const tmpPy = path.join(os.tmpdir(), `whisper_srt_${Date.now()}.py`);
  try {
    fs.writeFileSync(tmpPy, pyScript, 'utf8');
    const { stdout } = await execFileAsync('python3', [tmpPy, ttsPath, lang], {
      timeout: 120000,
    });

    if (stdout.startsWith('WHISPER_NOT_AVAILABLE') || stdout.startsWith('NO_WORDS')) {
      logger.warn(MODULE, `Whisper unavailable or no words transcribed: ${stdout.trim()}`);
      return null;
    }

    fs.writeFileSync(srtPath, stdout, 'utf8');
    const cardCount = (stdout.match(/^\d+$/mg) || []).length;
    logger.info(MODULE, `SRT generated (Whisper, ${cardCount} cards) → ${srtPath}`);
    return srtPath;
  } catch (err) {
    logger.warn(MODULE, `Whisper SRT failed: ${err.message}`);
    return null;
  } finally {
    fs.rmSync(tmpPy, { force: true });
  }
}

/**
 * SRT ファイルを ASS 字幕形式に変換する。
 * libass でピクセル精度のスタイリングを行うため、PlayResX/Y を実際の
 * 動画解像度に合わせて設定する。
 *
 * @param {string} srtPath - 入力 .srt ファイルパス
 * @param {'short'|'long'} type - 動画タイプ（解像度の決定に使用）
 * @param {string} assPath - 書き出し先の .ass ファイルパス
 * @returns {string} assPath
 */
function convertSRTtoASS(srtPath, type, assPath) {
  const s         = STYLE[resolveStyleKey(type)];
  const W         = s.width;
  const H         = s.height;
  const fontSize  = Math.round(H * 0.032);   // ~61px（ショート）/ ~35px（ロング）
  const marginV   = Math.round(H * 0.22);    // 下端から 22%（YouTube Shorts UI の上）
  const marginLR  = Math.round(W * 0.05);
  const boxPad    = Math.round(fontSize * 0.35);

  const assHeader = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 1',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Noto Sans JP,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,1,0,3,${boxPad},0,2,${marginLR},${marginLR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  /** SRT タイムスタンプ HH:MM:SS,mmm → ASS H:MM:SS.cc */
  function srtTsToAss(ts) {
    const [hms, ms] = ts.trim().split(',');
    const [h, m, sc] = hms.split(':');
    return `${parseInt(h, 10)}:${m}:${sc}.${String(Math.floor(parseInt(ms, 10) / 10)).padStart(2, '0')}`;
  }

  const srtText = fs.readFileSync(srtPath, 'utf8').trim();
  const blocks  = srtText.split(/\n\n+/);
  const dialogues = blocks.flatMap(block => {
    const lines = block.trim().split('\n');
    if (lines.length < 3 || !lines[1].includes(' --> ')) return [];
    const [startRaw, endRaw] = lines[1].split(' --> ');
    const text = lines.slice(2).join(' ')
      .replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    return [`Dialogue: 0,${srtTsToAss(startRaw)},${srtTsToAss(endRaw)},Default,,0,0,0,,${text}`];
  });

  fs.writeFileSync(assPath, assHeader + '\n' + dialogues.join('\n') + '\n', 'utf8');
  logger.info(MODULE, `ASS subtitle written (${dialogues.length} lines) → ${assPath}`);
  return assPath;
}

/**
 * 音声ファイルの再生時間を ffprobe で取得する。
 * 失敗した場合はシーン duration の合計を返す。
 *
 * @param {string} audioPath
 * @param {number} fallback - フォールバック値（秒）
 * @returns {Promise<number>}
 */
async function getAudioDuration(audioPath, fallback = 30) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]);
    const d = parseFloat(stdout.trim());
    return isFinite(d) && d > 0 ? d : fallback;
  } catch {
    return fallback;
  }
}

// ── BGM 選択 ──────────────────────────────────────────────────────────

function pickBgm() {
  if (!fs.existsSync(BGM_DIR)) return null;
  const files = fs.readdirSync(BGM_DIR).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
  if (files.length === 0) return null;
  return path.join(BGM_DIR, files[Math.floor(Math.random() * files.length)]);
}

// ── CLI 直接実行 ──────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [type, date] = process.argv.slice(2);
  runRender({ type: type ?? 'short', date });
}
