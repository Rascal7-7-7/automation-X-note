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
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';
import { isHeyGenAvailable, generateAvatarVideo, downloadVideo as heygenDownload, listVoices } from '../shared/heygen-client.js';
import { isDIDAvailable, generateTalkingVideo, downloadVideo as didDownload } from '../shared/did-client.js';

const execFileAsync = promisify(execFile);
const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR    = path.join(__dirname, 'drafts');
const MODULE        = 'instagram:render';

const GITHUB_OWNER  = 'rascal7-7-7';
const GITHUB_REPO   = 'automation-X-note';
const GITHUB_BRANCH = 'main';
const REELS_PATH    = 'instagram-reels';

// YouTube assets を共用（Noto Sans JP フォント + BGM）
const YT_ASSETS_DIR = path.join(__dirname, '../youtube/assets');
const FONTS_DIR     = path.join(YT_ASSETS_DIR, 'fonts');
const BGM_DIR       = path.join(YT_ASSETS_DIR, 'bgm');

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
      result = await renderWithFFmpeg(draft, outDir, { account, today });
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

// ── GitHub へアップロード ─────────────────────────────────────────────

async function uploadToGitHub(videoBuffer, filename, retries = 3) {
  const token = execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  }).trim();

  const filePath = `${REELS_PATH}/${filename}`;
  const apiUrl   = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const base64   = videoBuffer.toString('base64');

  for (let attempt = 0; attempt < retries; attempt++) {
    const body = {
      message: `chore: add instagram reels ${filename}`,
      content: base64,
      branch:  GITHUB_BRANCH,
    };

    const res  = await fetch(apiUrl, {
      method:  'PUT',
      headers: {
        Authorization:          `Bearer ${token}`,
        'Content-Type':         'application/json',
        Accept:                 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 201) {
      return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;
    }

    // 409 = branch HEAD moved (parallel upload race) — wait and retry
    if (res.status === 409 && attempt < retries - 1) {
      const wait = 2000 + attempt * 1000;
      logger.warn(MODULE, `GitHub upload 409 conflict, retrying in ${wait}ms (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    const data = await res.json();
    throw new Error(`GitHub upload failed (${res.status}): ${JSON.stringify(data)}`);
  }
}

// ── ffmpeg スライドショー（フォールバック） ───────────────────────────

function pickBgm() {
  if (!fs.existsSync(BGM_DIR)) return null;
  const files = fs.readdirSync(BGM_DIR).filter(f => /\.(mp3|wav)$/.test(f));
  if (!files.length) return null;
  return path.join(BGM_DIR, files[Math.floor(Math.random() * files.length)]);
}

function parseScriptSegments(reelsScript) {
  const SKIP = [
    /^---/,
    /^\[/,
    /^#/,
    /^【/,
    /^\d+\s*[〜~\-]\s*\d+秒/,
    /^（\d+[-〜]\d+秒）/,
    /^ステップ\d/,
    /^台本[:：]/,
    /Reels台本/,
    /^想定ビジュアル/,
    /^パターン[AB]/,
    /^CTA/,
    /^〈/,
    /^\*\s*〈/,
  ];
  return reelsScript
    .split('\n')
    .map(l => l
      .replace(/^#{1,3}\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/【.*?】/g, '')
      .replace(/^\*\s+/, '')
      .replace(/^「/, '').replace(/」$/, '') // 鍵括弧除去
      .trim()
    )
    .filter(l => l.length > 3 && !SKIP.some(re => re.test(l)));
}

function toAssTime(secs) {
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = Math.floor(secs % 60);
  const cs = Math.round((secs % 1) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

function buildAssFile(segments, totalDuration, assPath) {
  const W        = 1080;
  const H        = 1920;
  const fontSize = Math.round(H * 0.028);   // ~54px
  const marginV  = Math.round(H * 0.15);
  const marginLR = Math.round(W * 0.05);
  const boxPad   = Math.round(fontSize * 0.35);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Noto Sans JP,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,1,0,3,${boxPad},0,2,${marginLR},${marginLR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  // 最低3秒/セグメント — 多すぎる場合は隣接セグメントをマージ
  const MIN_SEG_DUR = 3;
  const maxSegs = Math.max(1, Math.floor(totalDuration / MIN_SEG_DUR));
  const capped  = segments.slice(0, maxSegs * 2); // 先頭から取りすぎ防止
  // maxSegs に収まるようにグループ化（余剰行は前のセグメントに結合）
  const grouped = [];
  const chunkSize = Math.ceil(capped.length / maxSegs);
  for (let i = 0; i < capped.length; i += chunkSize) {
    grouped.push(capped.slice(i, i + chunkSize).join(' '));
  }

  const segDur = totalDuration / grouped.length;
  const dialogues = grouped.map((seg, i) => {
    const start = i * segDur;
    const end   = Math.min((i + 1) * segDur, totalDuration);
    const text  = seg.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    return `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Default,,0,0,0,,{\\fad(200,200)}${text}`;
  });

  fs.writeFileSync(assPath, header + '\n' + dialogues.join('\n') + '\n', 'utf8');
}

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

async function renderWithFFmpeg(draft, outDir, { account, today }) {
  let imagePath = draft.imagePath;

  if (!imagePath || !fs.existsSync(imagePath)) {
    if (!draft.imageUrl) {
      throw new Error('ffmpeg fallback requires draft.imagePath or imageUrl — run instagram:image first');
    }
    const ext     = path.extname(new URL(draft.imageUrl).pathname) || '.png';
    const tmpPath = path.join(outDir, `_dl_image${ext}`);
    logger.info(MODULE, `downloading imageUrl → ${tmpPath}`);
    await downloadImageToFile(draft.imageUrl, tmpPath);
    imagePath = tmpPath;
  }

  const duration = 25;
  const filename = `reels_${today}_account${account}_${Date.now()}.mp4`;
  const outPath  = path.join(outDir, filename);
  const assPath  = path.join(outDir, 'reels.ass');
  const bgmPath  = pickBgm();

  // ASS字幕生成（Noto Sans JP）
  const segments = parseScriptSegments(draft.reelsScript);
  if (segments.length > 0) {
    buildAssFile(segments, duration, assPath);
    logger.info(MODULE, `ASS subtitles: ${segments.length} segments`);
  }

  const hasAss   = fs.existsSync(assPath) && segments.length > 0;
  const fontsDir = FONTS_DIR.replace(/\\/g, '/').replace(/:/g, '\\:');
  const assEsc   = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  const scaleFilter = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2';
  const vf = hasAss
    ? `${scaleFilter},ass='${assEsc}':fontsdir='${fontsDir}'`
    : scaleFilter;

  const ffmpegArgs = [
    '-y',
    '-loop', '1', '-i', imagePath,
    ...(bgmPath ? ['-stream_loop', '-1', '-i', bgmPath] : []),
    '-t', String(duration),
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    ...(bgmPath ? ['-c:a', 'aac', '-b:a', '128k', '-af', 'volume=0.25', '-shortest'] : []),
    outPath,
  ];

  await execFileAsync('ffmpeg', ffmpegArgs);

  logger.info(MODULE, `uploading reels to GitHub → ${filename}`);
  const videoBuffer   = fs.readFileSync(outPath);
  const reelsVideoUrl = await uploadToGitHub(videoBuffer, filename);
  logger.info(MODULE, `reels video public URL: ${reelsVideoUrl}`);

  return { reelsVideoPath: outPath, reelsVideoUrl };
}

// ── CLI ──────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [account, date] = process.argv.slice(2);
  runRender({ account: account ? Number(account) : 1, date });
}
