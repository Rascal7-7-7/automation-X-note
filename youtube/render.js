/**
 * YouTube 動画レンダリングモジュール
 *
 * フロー（HeyGen優先）:
 *   1. youtube/drafts/{date}/{type}.json を読み込む
 *   2-a. HEYGEN_API_KEY が設定されている場合:
 *        HeyGen v3 API でアバター動画を生成して video_heygen.mp4 に保存
 *   2-b. 未設定の場合（フォールバック）:
 *        Nanobanana Pro（Gemini）でシーン画像を生成
 *        FFmpeg で画像 + テロップ + BGM を合成して mp4 を出力
 *   3. draft.videoPath に保存パスを書き込む
 *
 * 必要な環境変数:
 *   HEYGEN_API_KEY  - HeyGen アバター動画生成（優先）
 *   GEMINI_API_KEY  - Nanobanana Pro フォールバック用
 *
 * 必要なツール（フォールバック時のみ）:
 *   ffmpeg（apt install ffmpeg）
 *   python3 + google-genai（Nanobanana Pro）
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
const FONT_PATH   = path.join(ASSETS_DIR, 'fonts', 'NotoSansJP-Bold.ttf');
const NANOBANANA  = path.join(
  process.env.HOME, '.claude/skills/nanobanana/generate_image.py'
);
const VENV_PYTHON = path.join(
  process.env.HOME, '.claude/skills/nanobanana/venv/bin/python3'
);

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

      await assembleVideo({ type, scenes, imagePaths, bgmPath, outPath });
      videoPath = outPath;
    }

    // draft を更新
    const updated = {
      ...draft,
      videoPath,
      status:     'rendered',
      renderedAt: new Date().toISOString(),
    };
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
  if (!script) return [{ text: 'AI副業ハック', duration: type === 'short' ? 10 : 30 }];

  const lines = script
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'));

  if (type === 'short') {
    // ショート: 1行1シーン、各10秒
    return lines.slice(0, 6).map(text => ({ text, duration: 10 }));
  } else {
    // ロング: チャプター単位でシーン化
    const scenes = [];
    let current = '';
    for (const line of lines) {
      if (/^\[/.test(line)) {
        if (current) scenes.push({ text: current.trim(), duration: 30 });
        current = line.replace(/^\[.*?\]\s*/, '');
      } else {
        current += ' ' + line;
      }
    }
    if (current) scenes.push({ text: current.trim(), duration: 30 });
    return scenes.slice(0, 20);
  }
}

// ── Nanobanana Pro で画像生成 ──────────────────────────────────────

async function generateSceneImages(scenes, outDir, type) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || !fs.existsSync(NANOBANANA)) {
    logger.warn(MODULE, 'Nanobanana Pro not available, using fallback gradient images');
    return scenes.map((_, i) => generateFallbackImage(outDir, i, type));
  }

  const ratio = type === 'short' ? '9:16' : '16:9';
  const paths = [];

  for (let i = 0; i < scenes.length; i++) {
    const imgPath = path.join(outDir, `scene_${i}.png`);
    if (fs.existsSync(imgPath)) {
      paths.push(imgPath);
      continue;
    }

    const prompt = buildImagePrompt(scenes[i].text, type);
    const aspect = type === 'short' ? '9:16' : '16:9';
    try {
      // --output はディレクトリ指定、ファイル名はタイムスタンプ自動生成
      const tmpDir = path.join(outDir, `tmp_scene_${i}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      await execFileAsync(
        VENV_PYTHON,
        [NANOBANANA, prompt, '--aspect', aspect, '--output', tmpDir],
        { env: { ...process.env, GEMINI_API_KEY: geminiKey }, timeout: 60000 }
      );
      // 生成されたファイルを scene_N.png にリネーム
      const generated = fs.readdirSync(tmpDir).find(f => /\.(png|jpg|webp)$/i.test(f));
      if (!generated) throw new Error('no image generated');
      fs.renameSync(path.join(tmpDir, generated), imgPath);
      fs.rmdirSync(tmpDir);
      paths.push(imgPath);
      logger.info(MODULE, `scene image ${i + 1}/${scenes.length} generated`);
    } catch (err) {
      logger.warn(MODULE, `scene ${i} image failed, using fallback: ${err.message}`);
      paths.push(generateFallbackImage(outDir, i, type));
    }
  }

  return paths;
}

function buildImagePrompt(text, type) {
  const ratio = type === 'short' ? 'vertical 9:16' : 'horizontal 16:9';
  return (
    `YouTube ${type === 'short' ? 'Shorts' : 'video'} background, ${ratio}, ` +
    `dark navy blue gradient background, tech and AI theme, ` +
    `clean minimalist design, no text, no people, ` +
    `subtle glowing circuit pattern, professional look, ` +
    `inspired by: ${text.slice(0, 50)}`
  );
}

function generateFallbackImage(outDir, index, type) {
  // FFmpegのcolor filterで単色背景を生成（画像ファイルなし）
  // 後のassembleVideoでcolor=入力として処理する
  const colors = ['0x1a1a2e', '0x16213e', '0x0f3460', '0x533483', '0x2d6a4f'];
  const color = colors[index % colors.length];
  const flagPath = path.join(outDir, `fallback_${index}.txt`);
  fs.writeFileSync(flagPath, color);
  return `color:${color}`;
}

// ── FFmpeg 動画合成 ──────────────────────────────────────────────────

async function assembleVideo({ type, scenes, imagePaths, bgmPath, outPath }) {
  const s = STYLE[type];
  const totalDuration = scenes.reduce((sum, sc) => sum + sc.duration, 0);

  // 入力リスト作成（concat demuxer用）
  const listPath = outPath.replace('.mp4', '_concat.txt');
  const listLines = [];

  for (let i = 0; i < scenes.length; i++) {
    const imgPath = imagePaths[i];
    if (imgPath.startsWith('color:')) {
      // フォールバック: 単色背景をFFmpegで生成
      const color = imgPath.replace('color:', '');
      const framePath = outPath.replace('.mp4', `_frame${i}.png`);
      await execFileAsync('ffmpeg', [
        '-y', '-f', 'lavfi',
        '-i', `color=c=${color}:size=${s.width}x${s.height}:rate=1`,
        '-vframes', '1', framePath,
      ]);
      listLines.push(`file '${framePath}'`);
    } else {
      listLines.push(`file '${imgPath}'`);
    }
    listLines.push(`duration ${scenes[i].duration}`);
  }
  fs.writeFileSync(listPath, listLines.join('\n'));

  // テロップ用 drawtext フィルター生成
  const drawTextFilters = buildDrawTextFilters(scenes, s);

  // FFmpeg コマンド組み立て
  const ffmpegArgs = [
    '-y',
    '-f', 'concat', '-safe', '0', '-i', listPath,
  ];

  if (bgmPath && fs.existsSync(bgmPath)) {
    ffmpegArgs.push('-stream_loop', '-1', '-i', bgmPath);
  }

  // ビデオフィルター: スケール + テロップ
  const vf = [`scale=${s.width}:${s.height}:force_original_aspect_ratio=decrease`,
              `pad=${s.width}:${s.height}:(ow-iw)/2:(oh-ih)/2:black`,
              ...drawTextFilters].join(',');

  ffmpegArgs.push('-vf', vf);

  if (bgmPath && fs.existsSync(bgmPath)) {
    ffmpegArgs.push(
      '-c:a', 'aac', '-b:a', '128k',
      '-af', `afade=t=out:st=${Math.max(0, totalDuration - 2)}:d=2`,
      '-shortest',
    );
  }

  ffmpegArgs.push(
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-t', String(totalDuration),
    '-pix_fmt', 'yuv420p',
    outPath,
  );

  await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 300000 });

  // 一時ファイル削除
  fs.unlinkSync(listPath);
}

function buildDrawTextFilters(scenes, style) {
  const filters = [];
  let elapsed = 0;

  for (const scene of scenes) {
    const start = elapsed;
    const end   = elapsed + scene.duration;
    const text  = scene.text.replace(/'/g, "\\'").replace(/:/g, '\\:').slice(0, 60);
    const fontArg = fs.existsSync(FONT_PATH) ? `fontfile=${FONT_PATH}:` : '';

    filters.push(
      `drawtext=${fontArg}` +
      `text='${text}':` +
      `fontcolor=${style.fontColor}:` +
      `fontsize=${style.fontSize}:` +
      `box=1:boxcolor=${style.bgColor}:boxborderw=12:` +
      `x=(w-text_w)/2:` +
      `y=h-text_h-${style.margin}:` +
      `line_spacing=${style.lineSpacing}:` +
      `enable='between(t,${start},${end})'`
    );
    elapsed += scene.duration;
  }

  return filters;
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
