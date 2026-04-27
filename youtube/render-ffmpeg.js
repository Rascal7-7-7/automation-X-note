/**
 * YouTube レンダリング — TTS + FFmpeg + 字幕モジュール
 *
 * 抽出関数:
 *   formatVTTTime, isAivisRunning, generateAivisScene,
 *   generateTTS (export), mergeVTTWithOffset, convertVTTtoSRT,
 *   generateKenBurnsClip (export), generateSETrack, addLoopEnding,
 *   assembleVideo (export), secondsToSrtTs, generateSRTFromScenes,
 *   generateSRTWithWhisper, wrapSubtitleText, highlightKeywords,
 *   convertSRTtoASS (export), getAudioDuration, pickBgm (export)
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../shared/logger.js';

const execFileAsync = promisify(execFile);

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, 'assets');
const BGM_DIR    = path.join(ASSETS_DIR, 'bgm');
const SE_DIR     = path.join(ASSETS_DIR, 'se');

const MODULE = 'youtube:render';

// ── テロップカラーパレット（YPP 反復コンテンツ対策：動画ごとに変化） ──────────
// ASS カラー形式: &HAABBGGRR (アルファ・青・緑・赤)
export const CAPTION_PALETTES = [
  { primary: '&H00FFFFFF', hook: '&H0000FFFF' }, // 白 / 黄（デフォルト・最高視認性）
  { primary: '&H0000FFFF', hook: '&H00FFFFFF' }, // 黄 / 白
  { primary: '&H00F0F0F0', hook: '&H0010D0FF' }, // オフホワイト / オレンジ
  { primary: '&H00FFFFFF', hook: '&H000070FF' }, // 白 / 赤（緊急・速報系）
];

// ── テロップ設定 ──────────────────────────────────────────────────
export const STYLE = {
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
export function resolveStyleKey(type) {
  if (STYLE[type]) return type;
  if (type.includes('long')) return 'long';
  return 'short';
}

// ── AivisSpeech TTS（ローカルAPI・高品質日本語）────────────────────────

const AIVIS_API        = 'http://localhost:50021';   // VOICEVOX
const AIVIS_SPEAKER_ID = process.env.AIVIS_SPEAKER_ID ?? 8;           // 春日部つむぎ ノーマル

function formatVTTTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(3).padStart(6, '0');
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${s}`;
} // まお — あまあま（あんずもも未インストール時の代替）

async function isAivisRunning() {
  try {
    const res = await fetch(`${AIVIS_API}/version`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch { return false; }
}

async function generateAivisScene(text, speedScale, wavPath) {
  const qRes = await fetch(
    `${AIVIS_API}/audio_query?text=${encodeURIComponent(text)}&speaker=${AIVIS_SPEAKER_ID}`,
    { method: 'POST' },
  );
  if (!qRes.ok) throw new Error(`audio_query failed: ${await qRes.text()}`);
  const query = await qRes.json();
  query.speedScale = speedScale;

  const sRes = await fetch(
    `${AIVIS_API}/synthesis?speaker=${AIVIS_SPEAKER_ID}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) },
  );
  if (!sRes.ok) throw new Error(`synthesis failed: ${await sRes.text()}`);
  fs.writeFileSync(wavPath, Buffer.from(await sRes.arrayBuffer()));
}

// ── TTS 音声生成（AivisSpeech優先 → edge-ttsフォールバック）──────────
//
// 各シーンごとに個別 TTS を生成しシーン長にパディングして結合する。
// これにより映像・字幕・ナレーションの3つが完全に同期する。

export async function generateTTS(scenes, outDir, type = 'short') {
  const prefix  = resolveStyleKey(type); // 'short' or 'long'
  const ttsPath = path.join(outDir, `${prefix}_tts.mp3`);
  const vttPath = path.join(outDir, `${prefix}_tts.vtt`);
  if (fs.existsSync(ttsPath)) {
    // Sync scene durations from cached VTT so Ken Burns clips align with narration
    if (fs.existsSync(vttPath)) {
      try {
        const vtt = fs.readFileSync(vttPath, 'utf8');
        const starts = [...vtt.matchAll(/^(\d{2}:\d{2}:\d{2}\.\d{3}) -->/gm)]
          .map(m => { const [h, mn, s] = m[1].split(':').map(Number); return h * 3600 + mn * 60 + s; });
        const ends = [...vtt.matchAll(/--> (\d{2}:\d{2}:\d{2}\.\d{3})/gm)]
          .map(m => { const [h, mn, s] = m[1].split(':').map(Number); return h * 3600 + mn * 60 + s; });
        for (let i = 0; i < Math.min(starts.length, scenes.length); i++) {
          const dur = i < starts.length - 1
            ? starts[i + 1] - starts[i]
            : ends[i] - starts[i] + 1.2;
          scenes[i].duration = parseFloat(dur.toFixed(2));
        }
        logger.info('youtube:render', 'scene durations synced from cached VTT');
      } catch { /* leave defaults */ }
    }
    return { ttsPath, vttPath: fs.existsSync(vttPath) ? vttPath : null };
  }

  const useAivis  = await isAivisRunning();
  const voice     = 'ja-JP-NanamiNeural';
  const ttsRate   = scenes.length <= 8 ? '+0%' : '+10%';
  const aivisSpeed = scenes.length <= 8 ? 1.0 : 1.1;
  const PAUSE_SEC = 1.2;

  if (useAivis) logger.info(MODULE, `TTS: VOICEVOX (speaker=${AIVIS_SPEAKER_ID} / 春日部つむぎ)`);
  else          logger.info(MODULE, 'TTS: edge-tts fallback');

  const sceneTmps = [];
  const vttInfos  = [];
  let offset = 0;

  for (let i = 0; i < scenes.length; i++) {
    const rawWav  = path.join(outDir, `tts_raw_${i}.wav`);
    const rawMp3  = path.join(outDir, `tts_raw_${i}.mp3`);
    const rawVtt  = path.join(outDir, `tts_raw_${i}.vtt`);
    const padMp3  = path.join(outDir, `tts_pad_${i}.mp3`);
    sceneTmps.push(rawWav, rawMp3, rawVtt, padMp3);

    if (useAivis) {
      try {
        await generateAivisScene(scenes[i].text, aivisSpeed, rawWav);
        await execFileAsync('ffmpeg', ['-y', '-i', rawWav, '-c:a', 'libmp3lame', '-q:a', '2', rawMp3]);
      } catch (err) {
        logger.warn(MODULE, `AivisSpeech scene ${i} failed: ${err.message}`);
        await execFileAsync('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
          '-t', '3', '-c:a', 'libmp3lame', '-q:a', '4', rawMp3,
        ]);
      }
    } else {
      try {
        await execFileAsync('edge-tts', [
          '--text',            scenes[i].text,
          '--voice',           voice,
          '--rate',            ttsRate,
          '--write-media',     rawMp3,
          '--write-subtitles', rawVtt,
        ]);
      } catch (err) {
        logger.warn(MODULE, `TTS scene ${i} failed: ${err.message}`);
        await execFileAsync('ffmpeg', [
          '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
          '-t', '3', '-c:a', 'libmp3lame', '-q:a', '4', rawMp3,
        ]);
      }
    }

    // 実際のTTS音声の長さを取得してシーン長を動的に決める
    const ttsDuration = await getAudioDuration(rawMp3, 3);
    const sceneDur    = parseFloat((ttsDuration + PAUSE_SEC).toFixed(2));

    // TTS後にPAUSE_SEC秒の無音を付加
    await execFileAsync('ffmpeg', [
      '-y', '-i', rawMp3,
      '-af', `apad=whole_dur=${sceneDur}`,
      '-t', String(sceneDur),
      '-c:a', 'libmp3lame', '-q:a', '4',
      padMp3,
    ]);

    // scenes[i].duration を実測値で上書き（映像生成側が参照）
    scenes[i].duration = sceneDur;

    if (useAivis) {
      // AivisSpeech はVTTを出力しないため、シーンのタイミングから直接生成
      const ttsDur = sceneDur - PAUSE_SEC;
      fs.writeFileSync(rawVtt, [
        'WEBVTT', '',
        `00:00:00.000 --> ${formatVTTTime(ttsDur)}`,
        scenes[i].text, '',
      ].join('\n'), 'utf8');
      vttInfos.push({ vttPath: rawVtt, offset });
    } else {
      vttInfos.push({ vttPath: rawVtt, offset });
    }
    offset += sceneDur;
  }

  const listPath = path.join(outDir, 'tts_list.txt');
  fs.writeFileSync(listPath,
    scenes.map((_, i) => `file '${path.join(outDir, `tts_pad_${i}.mp3`)}'`).join('\n'),
    'utf8'
  );
  await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, ttsPath]);
  fs.unlinkSync(listPath);

  mergeVTTWithOffset(vttInfos, vttPath);

  for (const p of sceneTmps) fs.rmSync(p, { force: true });

  logger.info(MODULE, `TTS generated (${scenes.length} scenes, total ${offset.toFixed(1)}s) → ${ttsPath}`);
  return { ttsPath, vttPath: fs.existsSync(vttPath) ? vttPath : null };
}


/** 複数 VTT ファイルをタイムスタンプオフセット付きで1ファイルにマージ */
function mergeVTTWithOffset(vttInfos, outPath) {
  const lines = ['WEBVTT', ''];
  let idx = 1;

  function addSec(ts, sec) {
    // edge-tts outputs HH:MM:SS,mmm (comma) — normalize to period before parsing
    const parts = ts.trim().replace(',', '.').split(':');
    let h = 0, m = 0, s = 0;
    if (parts.length === 3) { [h, m, s] = parts.map(Number); }
    else                    { [m, s]    = parts.map(Number); }
    const total  = h * 3600 + m * 60 + s + sec;
    const nh = Math.floor(total / 3600);
    const nm = Math.floor((total % 3600) / 60);
    const ns = (total % 60).toFixed(3).padStart(6, '0');
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:${ns}`;
  }

  for (const { vttPath, offset } of vttInfos) {
    if (!fs.existsSync(vttPath)) continue;
    const raw    = fs.readFileSync(vttPath, 'utf8');
    const blocks = raw.split(/\n\n+/);
    for (const block of blocks) {
      const blines   = block.trim().split('\n');
      const timeLine = blines.find(l => l.includes(' --> '));
      if (!timeLine) continue;
      const [s, e] = timeLine.split(' --> ');
      const text   = blines.slice(blines.indexOf(timeLine) + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (!text) continue;
      lines.push(String(idx++), `${addSec(s, offset)} --> ${addSec(e, offset)}`, text, '');
    }
  }

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
}

/**
 * edge-tts が出力する WebVTT を SRT に変換する。
 * VTT の各 cue は単語レベルの正確なタイムスタンプを持つため、
 * シーンベースより音声と字幕が自然に同期する。
 * 隣接する cue をグループ化して 1 カードあたり最大 MAX_CHARS 文字に収める。
 *
 * @param {string} vttPath - 入力 .vtt ファイルパス
 * @param {string} srtPath - 書き出し先 .srt ファイルパス
 * @param {number} maxChars - 1 カードの最大文字数（デフォルト 15）
 * @returns {string|null} srtPath or null on failure
 */
function convertVTTtoSRT(vttPath, srtPath, maxChars = 15, totalDuration = null) {
  try {
    const raw = fs.readFileSync(vttPath, 'utf8');

    // VTT タイムスタンプ HH:MM:SS,mmm or HH:MM:SS.mmm → 秒
    function vttTsToSec(ts) {
      const parts = ts.trim().replace(',', '.').split(':');
      const [h, m, s] = parts.length === 3
        ? [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])]
        : [0, parseFloat(parts[0]), parseFloat(parts[1])];
      return h * 3600 + m * 60 + s;
    }

    // VTT cue をパース（NOTE/WEBVTT ヘッダーをスキップ）
    const cues = [];
    const blocks = raw.split(/\n\n+/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const timeLine = lines.find(l => l.includes(' --> '));
      if (!timeLine) continue;
      const [startRaw, endRaw] = timeLine.split(' --> ');
      const text = lines.slice(lines.indexOf(timeLine) + 1).join('').replace(/<[^>]+>/g, '').trim();
      if (!text) continue;
      cues.push({ start: vttTsToSec(startRaw), end: vttTsToSec(endRaw), text });
    }

    if (cues.length === 0) return null;

    // 隣接 cue をグループ化（maxChars を超えたら新カード）
    const cards = [];
    let buf = '';
    let bufStart = cues[0].start;
    let bufEnd   = cues[0].end;

    for (const cue of cues) {
      if (buf.length > 0 && buf.length + cue.text.length > maxChars) {
        cards.push({ start: bufStart, end: bufEnd, text: buf });
        buf = cue.text;
        bufStart = cue.start;
        bufEnd   = cue.end;
      } else {
        buf     += cue.text;
        bufEnd   = cue.end;
      }
    }
    if (buf) cards.push({ start: bufStart, end: bufEnd, text: buf });
    if (cards.length === 0) return null;

    // 各カードの end を次カードの start まで延ばしてギャップを埋める
    for (let i = 0; i < cards.length - 1; i++) {
      cards[i].end = cards[i + 1].start - 0.05;
    }
    // 最後のカードを動画末まで延ばす
    if (totalDuration != null) {
      cards[cards.length - 1].end = totalDuration - 0.05;
    }

    const srtLines = cards.map((c, i) =>
      `${i + 1}\n${secondsToSrtTs(c.start)} --> ${secondsToSrtTs(c.end)}\n${c.text}\n`
    );

    fs.writeFileSync(srtPath, srtLines.join('\n'), 'utf8');
    logger.info(MODULE, `SRT generated (VTT-sync, ${cards.length} cards) → ${srtPath}`);
    return srtPath;
  } catch (err) {
    logger.warn(MODULE, `VTT→SRT conversion failed: ${err.message}`);
    return null;
  }
}

// ── Ken Burns エフェクト付きクリップ生成 ─────────────────────────────────

export async function generateKenBurnsClip(imgPath, duration, type, outPath, effectIdx, punch = false) {
  const s      = STYLE[resolveStyleKey(type)];
  const fps    = 30;
  const frames = Math.round(duration * fps);
  // ズーム余裕1.2倍にスケールアップ→クロップして zoompan に渡す
  const W1 = Math.round(s.width  * 1.2);
  const H1 = Math.round(s.height * 1.2);
  const scaleCrop = `scale=${W1}:${H1}:force_original_aspect_ratio=increase,crop=${W1}:${H1}`;

  // scale=${s.width}:${s.height} を末尾に追加して出力解像度を強制固定
  const forceSize = `scale=${s.width}:${s.height}`;

  // ズームパンチ: 最初9フレーム(0.3s)で1.15→1.0に急速収束、その後通常エフェクト
  const zPunch = punch
    ? `if(lt(on,9),1.15-0.015*on,`
    : '';
  const zPunchClose = punch ? ')' : '';

  const effects = [
    // ズームイン（中央）
    `${scaleCrop},zoompan=z='${zPunch}1+0.1*(on/${frames})${zPunchClose}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps},${forceSize}`,
    // 右パン（固定ズーム）
    `${scaleCrop},zoompan=z='${zPunch}1.08${zPunchClose}':x='iw*0.07*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps},${forceSize}`,
    // ズームアウト（中央）
    `${scaleCrop},zoompan=z='${zPunch}max(1.1-0.1*(on/${frames}),1.0)${zPunchClose}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps},${forceSize}`,
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

// ── SE トラック生成 ──────────────────────────────────────────────────

async function generateSETrack(scenes, seDir, totalDuration, outDir, prefix = '') {
  const whoosh = path.join(seDir, 'whoosh.mp3');
  const impact = path.join(seDir, 'impact.mp3');
  const glitch = path.join(seDir, 'glitch.mp3');

  if (!fs.existsSync(whoosh)) return null;

  // シーン開始時刻を計算
  const starts = [];
  let t = 0;
  for (const sc of scenes) { starts.push(t); t += sc.duration; }

  // (file, delayMs) イベントリストを構築
  const events = [];
  for (let i = 1; i < scenes.length; i++) {
    events.push({ file: whoosh, delayMs: Math.round(starts[i] * 1000) });
  }
  if (scenes.length > 4 && fs.existsSync(impact)) {
    events.push({ file: impact, delayMs: Math.round(starts[4] * 1000) });
  }
  if (scenes.length > 5 && fs.existsSync(glitch)) {
    events.push({ file: glitch, delayMs: Math.round(starts[5] * 1000) });
  }
  if (events.length === 0) return null;

  const sePath = path.join(outDir, `${prefix}_se_track.wav`);
  const inputs = events.flatMap(e => ['-i', e.file]);
  const filterParts = events.map((e, i) => `[${i}:a]adelay=${e.delayMs}|${e.delayMs},volume=0.4[se${i}]`);
  const mixIn = events.map((_, i) => `[se${i}]`).join('');
  const filterComplex = filterParts.join(';') + `;${mixIn}amix=inputs=${events.length}:normalize=0[seout]`;

  await execFileAsync('ffmpeg', [
    '-y', ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[seout]',
    '-t', String(totalDuration),
    sePath,
  ], { timeout: 60000 });

  return sePath;
}

// ── ループエンディング（ショート専用）────────────────────────────────

async function addLoopEnding(outPath) {
  const tmpHead = outPath.replace('.mp4', '_loop_head.mp4');
  const tmpOrig = outPath.replace('.mp4', '_preloop.mp4');
  const listPath = outPath.replace('.mp4', '_loop.txt');

  await execFileAsync('ffmpeg', ['-y', '-i', outPath, '-t', '1.5', '-c:v', 'copy', '-an', tmpHead], { timeout: 30000 });
  fs.renameSync(outPath, tmpOrig);
  fs.writeFileSync(listPath, `file '${tmpOrig}'\nfile '${tmpHead}'`);
  await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath], { timeout: 60000 });

  for (const f of [tmpHead, tmpOrig, listPath]) fs.rmSync(f, { force: true });
}

// ── FFmpeg 動画合成 ──────────────────────────────────────────────────

export async function assembleVideo({ type, scenes, imagePaths, bgmPath, ttsPath, vttPath, outPath, hookText = null }) {
  const s = STYLE[resolveStyleKey(type)];
  const totalDuration = scenes.reduce((sum, sc) => sum + sc.duration, 0);
  const outDir = path.dirname(outPath);

  const hasBgm = bgmPath && fs.existsSync(bgmPath);
  const hasTts = ttsPath && fs.existsSync(ttsPath);

  // ── SE トラック生成 ────────────────────────────────────────────────
  // ── Ken Burns クリップ生成 ──────────────────────────────────────────
  const typePrefix = path.basename(outPath, '.mp4'); // 'short'/'long'/'reddit-short' — 同時実行時の衝突防止

  let seTrackPath = null;
  try {
    seTrackPath = await generateSETrack(scenes, SE_DIR, totalDuration, outDir, typePrefix);
  } catch (err) {
    logger.warn(MODULE, `SE track generation failed, skipping: ${err.message}`);
  }
  const hasSe = seTrackPath && fs.existsSync(seTrackPath);
  const clipPaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const clipPath = path.join(outDir, `${typePrefix}_kb_clip_${i}.mp4`);
    await generateKenBurnsClip(imagePaths[i], scenes[i].duration, type, clipPath, i, i > 0);
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
  if (hasSe) ffmpegArgs.push('-i', seTrackPath);

  // 入力インデックスを動的に計算（BGM=1, TTS=bgm+1, SE=bgm+tts+1）
  const bgmIdx = hasBgm ? 1 : -1;
  const ttsIdx = hasBgm ? 2 : (hasTts ? 1 : -1);
  const seIdx  = (hasBgm ? 1 : 0) + (hasTts ? 1 : 0) + 1;

  if (hasTts && hasBgm) {
    const fadeStart = Math.max(0, totalDuration - 2);
    let filterComplex;
    if (hasSe) {
      filterComplex =
        `[${ttsIdx}:a]apad=whole_dur=${totalDuration}[ttspad];` +
        `[${bgmIdx}:a]volume=0.12[bgm];` +
        `[${seIdx}:a]volume=0.35[se];` +
        `[ttspad][bgm][se]amix=inputs=3:duration=first:normalize=0,` +
        `afade=t=out:st=${fadeStart}:d=2[aout]`;
    } else {
      filterComplex =
        `[${ttsIdx}:a]apad=whole_dur=${totalDuration}[ttspad];` +
        `[${bgmIdx}:a]volume=0.12[bgm];` +
        `[ttspad][bgm]amix=inputs=2:duration=first:normalize=0,` +
        `afade=t=out:st=${fadeStart}:d=2[aout]`;
    }
    ffmpegArgs.push(
      '-filter_complex', filterComplex,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    );
  } else if (hasTts) {
    ffmpegArgs.push(
      '-map', '0:v', '-map', `${ttsIdx}:a`,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-shortest',
    );
  } else if (hasBgm) {
    const fadeStart = Math.max(0, totalDuration - 2);
    ffmpegArgs.push(
      '-map', '0:v', '-map', `${bgmIdx}:a`,
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
    const lang    = process.env.YOUTUBE_SUBTITLE_LANG ?? 'ja';
    const hasVtt  = vttPath && fs.existsSync(vttPath);
    let srtResult = null;

    if (lang === 'ja' && hasVtt) {
      // 日本語: edge-tts VTT → 音声同期 SRT（short=12文字/カード, long=20文字/カード）
      const maxCharsForType = resolveStyleKey(type) === 'long' ? 20 : 12;
      srtResult = convertVTTtoSRT(vttPath, captionsPath, maxCharsForType, totalDuration);
    } else if (hasTts && lang !== 'ja') {
      // 英語等: Whisper で書き起こし
      srtResult = await generateSRTWithWhisper(ttsPath, captionsPath, lang);
    }

    // フォールバック: シーンテキストからタイムスタンプ計算
    if (!srtResult) {
      logger.info(MODULE, 'Falling back to scene-based SRT generation');
      generateSRTFromScenes(scenes, captionsPath);
    }

    convertSRTtoASS(captionsPath, type, assPath, Math.floor(Math.random() * CAPTION_PALETTES.length), hookText);
    resolvedAssPath = assPath;
  } catch (err) {
    logger.warn(MODULE, `Subtitle generation failed, skipping: ${err.message}`);
  }

  // ── Pass 2: 字幕焼き込み ──────────────────────────────────────────
  const pass2Args = ['-y', '-i', nosubPath];

  if (resolvedAssPath && fs.existsSync(resolvedAssPath)) {
    const assEscaped   = resolvedAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    pass2Args.push(
      '-vf', `ass='${assEscaped}'`,
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
  if (hasSe) fs.rmSync(seTrackPath, { force: true });

  return { captionsPath: fs.existsSync(captionsPath) ? captionsPath : null };
}

// ── 字幕生成（SRT / ASS） ────────────────────────────────────────────

/**
 * 秒数を SRT タイムスタンプ形式 HH:MM:SS,mmm に変換する。
 * @param {number} seconds
 * @returns {string}
 */
export function secondsToSrtTs(seconds) {
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
// 字幕を maxChars 文字ごとに改行（ASS ハード改行 \N）
// 句読点・助詞の直後を優先的に分割してネイティブな読み感を保つ
function wrapSubtitleText(text, maxChars = 11) {
  if (text.length <= maxChars) return text;
  const breakAfter = ['。', '、', 'が', 'は', 'を', 'に', 'で', 'と', 'も', 'て', 'の'];
  const isAsciiWord = (c) => /[a-zA-Z0-9_\-.]/.test(c);
  let result = '';
  let lineLen = 0;
  let i = 0;
  while (i < text.length) {
    result += text[i];
    lineLen++;
    if (lineLen >= maxChars) {
      // ASCII単語の途中なら単語末まで引っ張ってから改行
      while (i + 1 < text.length && isAsciiWord(text[i]) && isAsciiWord(text[i + 1])) {
        i++;
        result += text[i];
        lineLen++;
      }
      // 直後が句読点/助詞なら1文字含めてから改行
      const next = text[i + 1] ?? '';
      if (breakAfter.includes(next) && i + 1 < text.length) {
        result += next;
        i++;
      }
      if (i + 1 < text.length) { result += '\\N'; lineLen = 0; }
    }
    i++;
  }
  return result;
}

// 数字・ツール名・金額を黄色ハイライト（ASS override tag）
const YELLOW = '&H0000FFFF';  // ASS形式 AABBGGRR
const HIGHLIGHT_PATTERN = /(\d+[万円億%分時間本個秒]|\d+万[円以上]?|月\d+万|Claude\s*Code|ChatGPT|n8n|Cursor|Midjourney|無料|自動化|副業)/g;

function highlightKeywords(text, palette) {
  // hookText は palette.hook 色で全体が表示されるので追加着色不要
  return text.replace(HIGHLIGHT_PATTERN, (m) => `{\\c${YELLOW}&}${m}{\\r}`);
}

export function convertSRTtoASS(srtPath, type, assPath, paletteIdx = 0, hookText = null, opts = {}) {
  const { subtle = false } = opts;
  const s            = STYLE[resolveStyleKey(type)];
  const W            = s.width;
  const H            = s.height;
  // subtle モード: フォント小さめ・アウトラインのみ（ボックスなし）
  // 通常モード: 大型フォント（画面幅70%相当）・太アウトライン（視認性最優先）
  const fontScale    = subtle ? 0.018 : 0.038;
  const fontSize     = Math.round(H * fontScale);
  const hookFontSize = Math.round(fontSize * (subtle ? 1.1 : 1.2));
  const cardFontSize = Math.round(H * (subtle ? 0.032 : 0.048));
  const marginV      = Math.round(H * 0.22);
  const marginLR     = Math.round(W * 0.04);
  const outline      = subtle ? 2.5 : 4.0;  // 通常は太アウトラインで黒縁強調
  const shadow       = subtle ? 1   : 1;
  // subtle: BorderStyle=1（アウトライン）, 通常: BorderStyle=1（アウトライン・ボックスなし）
  const borderStyle  = 1;
  const backDefault  = '&H00000000';  // 背景なし（アウトラインで視認性確保）
  const backHook     = '&H00000000';
  const backCard     = subtle ? '&H55000000' : '&H66000000';

  const palette = CAPTION_PALETTES[paletteIdx % CAPTION_PALETTES.length];

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
    `Style: Default,ヒラギノ角ゴシック,${fontSize},${palette.primary},&H000000FF,&H00000000,${backDefault},1,0,0,0,100,100,1,0,${borderStyle},${outline},${shadow},2,${marginLR},${marginLR},${marginV},1`,
    `Style: Hook,ヒラギノ角ゴシック,${hookFontSize},${palette.hook},&H000000FF,&H00000000,${backHook},1,0,0,0,100,100,1,0,${borderStyle},${outline},${shadow},2,${marginLR},${marginLR},${marginV},1`,
    `Style: CardHook,ヒラギノ角ゴシック,${cardFontSize},&H00FFFFFF,&H000000FF,&H00000000,${backCard},1,0,0,0,100,100,2,0,${borderStyle},${outline},${shadow},5,0,0,0,1`,
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
  const dialogues = blocks.flatMap((block, blockIdx) => {
    const lines = block.trim().split('\n');
    if (lines.length < 3 || !lines[1].includes(' --> ')) return [];
    const [startRaw, endRaw] = lines[1].split(' --> ');
    const rawText = lines.slice(2).join(' ')
      .replace(/\{/g, '\\{').replace(/\}/g, '\\}');

    // CardHook（draft.hookText）が冒頭インパクトを担当するため、
    // 全ナレーション字幕は Default スタイルで統一（Hook style廃止）
    const style   = 'Default';
    const wrapped = wrapSubtitleText(rawText, 11);
    const text    = highlightKeywords(wrapped, palette);
    const startTs = srtTsToAss(startRaw);
    const fadeTag = '{\\fad(250,0)}';

    return [`Dialogue: 0,${startTs},${srtTsToAss(endRaw)},${style},,0,0,0,,${fadeTag}${text}`];
  });

  if (hookText) {
    const escaped = hookText.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    dialogues.unshift(`Dialogue: 1,0:00:00.00,0:00:02.50,CardHook,,0,0,0,,{\\fad(0,300)}${escaped}`);
  }

  fs.writeFileSync(assPath, assHeader + '\n' + dialogues.join('\n') + '\n', 'utf8');
  logger.info(MODULE, `ASS subtitle written (${dialogues.length} lines, palette:${paletteIdx}) → ${assPath}`);
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
export async function getAudioDuration(audioPath, fallback = 30) {
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

// ── フォールバック画像生成（グラデーション） ─────────────────────────────────

export async function generateFallbackImage(outDir, index, type) {
  const s = STYLE[resolveStyleKey(type)];
  const imgPath = path.join(outDir, `${resolveStyleKey(type)}_fallback_${index}.png`);

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

// ── BGM 選択 ──────────────────────────────────────────────────────────

export function pickBgm() {
  if (!fs.existsSync(BGM_DIR)) return null;
  const files = fs.readdirSync(BGM_DIR).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
  if (files.length === 0) return null;
  return path.join(BGM_DIR, files[Math.floor(Math.random() * files.length)]);
}
