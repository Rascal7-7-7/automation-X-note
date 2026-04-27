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
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../shared/logger.js';
import { saveJSON } from '../shared/file-utils.js';
import { captureSceneImage } from './capture.js';
import {
  isHeyGenAvailable,
  generateAvatarVideo,
  downloadVideo,
} from '../shared/heygen-client.js';
import {
  generateTTS,
  assembleVideo,
  pickBgm,
  generateFallbackImage,
  STYLE,
  resolveStyleKey,
} from './render-ffmpeg.js';
import {
  renderChatGPTShort,
  renderAnimeShort,
} from './render-clips.js';

const execFileAsync = promisify(execFile);

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR  = path.join(__dirname, 'drafts');
const ASSETS_DIR  = path.join(__dirname, 'assets');

const MODULE = 'youtube:render';

// ── テロップ設定（render-ffmpeg.js から再エクスポート — 外部参照互換） ────
// STYLE, CAPTION_PALETTES, resolveStyleKey は render-ffmpeg.js に定義済み。
// 本ファイルではインポートのみ使用。

// ── OpenAI（gpt-image-2）lazy instantiation ──────────────────────────
// Deferred so a missing OPENAI_API_KEY does not break other render types at startup.
// Call getOpenAI() (async) before any gpt-image-2 usage.
let _openai = null;
async function getOpenAI() {
  if (_openai) return _openai;
  // OPENAI_API_KEY2 = gpt-image-2専用キー、OPENAI_API_KEY = 共用キー
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

    if (type === 'anime-short') {
      // ── gpt-image-2 グリッド → Seedance 1コール 15秒 + 字幕 + BGM ──
      videoPath = await renderAnimeShort(draft, outDir, outPath);
    } else if (type === 'chatgpt-short') {
      // ── gpt-image-2 × Seedance 2.0 ストーリーボードパス ──────
      videoPath = await renderChatGPTShort(draft, type, outDir, outPath);
    } else if (isHeyGenAvailable()) {
      // ── HeyGen アバター動画生成パス ──────────────────────────
      videoPath = await renderWithHeyGen(draft, type, outDir);
    } else {
      // ── FFmpeg / Nanobanana フォールバックパス ────────────────
      logger.info(MODULE, 'HEYGEN_API_KEY not set, falling back to FFmpeg/Nanobanana');

      const scenes              = parseScenes(draft.script, type);
      const imagePaths          = await generateSceneImages(scenes, outDir, type, draft);
      const bgmPath             = pickBgm();
      const { ttsPath, vttPath } = await generateTTS(scenes, outDir, type);

      const { captionsPath } = await assembleVideo({ type, scenes, imagePaths, bgmPath, ttsPath, vttPath, outPath, hookText: draft.hookText ?? null });
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
    saveJSON(draftPath, updated);

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
    // ショート: 8シーン（手順型テンプレ対応）、duration は TTS 実測後に上書きされる
    return lines.slice(0, 8).map(text => ({
      text: text.slice(0, 50),
      duration: 10,
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
      if (scenes.length >= 12) break;
    }
    if (buffer && scenes.length < 12) {
      scenes.push({ text: buffer.trim().slice(0, 60), duration: 25 });
    }
    return scenes.length > 0 ? scenes : [{ text: 'AI副業ハック', duration: 30 }];
  }
}

// ── Gemini Imagen で画像生成 ───────────────────────────────────────

async function generateSceneImages(scenes, outDir, type, draft = null) {
  const geminiKey = process.env.GEMINI_API_KEY;

  // reddit-short の scene_0: 実際の Reddit 画像を優先使用
  const scene0Override = await resolveScene0Image(type, draft, outDir);

  if (!geminiKey) {
    logger.warn(MODULE, 'GEMINI_API_KEY not set, using fallback gradient images');
    const paths = await Promise.all(scenes.map((_, i) => generateFallbackImage(outDir, i, type)));
    if (scene0Override) paths[0] = scene0Override;
    return paths;
  }

  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const paths = [];

  for (let i = 0; i < scenes.length; i++) {
    const imgPath = path.join(outDir, `${resolveStyleKey(type)}_scene_${i}.png`);

    // scene_0 に Reddit 画像が取得できていれば Imagen をスキップ
    if (i === 0 && scene0Override) {
      paths.push(scene0Override);
      continue;
    }

    if (fs.existsSync(imgPath)) {
      paths.push(imgPath);
      continue;
    }

    // ── 1. Playwright capture（実UI / モックHTML）を優先 ──────────────────
    if (type !== 'reddit-short') {
      const captured = await captureSceneImage(scenes[i].text, i, imgPath, type, { proofNumber: draft?.proofNumber });
      if (captured) {
        paths.push(captured);
        logger.info(MODULE, `scene ${i + 1}/${scenes.length} captured (Playwright)`);
        continue;
      }
    }

    // ── 2. Imagen フォールバック ────────────────────────────────────────
    // scene 1以降はコメント/リアクション系プロンプトを優先
    const prompt = (i >= 1 && type === 'reddit-short')
      ? buildCommentScenePrompt(scenes[i].text, type)
      : buildImagePrompt(scenes[i].text, type, i);

    try {
      const result = await ai.models.generateImages({
        model:  'imagen-4.0-generate-001',
        prompt,
        config: { numberOfImages: 1, outputMimeType: 'image/png', aspectRatio: resolveStyleKey(type) === 'long' ? '16:9' : '9:16' },
      });

      const imageBytes = result.generatedImages?.[0]?.image?.imageBytes;
      if (!imageBytes) throw new Error('no image bytes returned');

      fs.writeFileSync(imgPath, Buffer.from(imageBytes, 'base64'));
      paths.push(imgPath);
      logger.info(MODULE, `scene image ${i + 1}/${scenes.length} generated (Imagen)`);
    } catch (err) {
      logger.warn(MODULE, `scene ${i} image failed, using fallback: ${err.message}`);
      paths.push(await generateFallbackImage(outDir, i, type));
    }
  }

  return paths;
}

/**
 * reddit-short の scene_0 に使う画像をダウンロードして返す。
 * imageUrl → thumbnailUrl の順で試み、いずれもなければ null を返す。
 */
async function resolveScene0Image(type, draft, outDir) {
  if (!draft) return null;

  // proof card: 専用パスで生成（AI生成シーン画像と分離）
  if (draft.proofNumber) {
    const proofPath = path.join(outDir, `${resolveStyleKey(type)}_proof_card.png`);
    if (!fs.existsSync(proofPath)) {
      try {
        await generateProofCard(draft.proofNumber, proofPath, resolveStyleKey(type));
        logger.info(MODULE, `proof card generated → ${proofPath}`);
      } catch (err) {
        logger.warn(MODULE, `proof card generation failed: ${err.message}`);
        return null;
      }
    }
    return proofPath;
  }

  const imgPath = path.join(outDir, `${resolveStyleKey(type)}_scene_0.png`);

  // reddit-short: Reddit 画像をダウンロード
  if (type !== 'reddit-short') return null;
  if (fs.existsSync(imgPath)) return imgPath;

  const url = draft.redditSource?.imageUrl ?? draft.thumbnailUrl ?? null;
  if (!url) return null;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'AutomationBot/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(imgPath, buf);
    logger.info(MODULE, `scene_0 Reddit image downloaded → ${imgPath}`);
    return imgPath;
  } catch (err) {
    logger.warn(MODULE, `scene_0 Reddit image download failed: ${err.message}`);
    return null;
  }
}

/**
 * 収益ダッシュボード風 proof card を FFmpeg drawtext で生成
 * 暗背景 + 緑の大型数字 + "先月の収益" ラベル — 実績証拠感を演出
 */
async function generateProofCard(proofNumber, outPath, styleKey) {
  const w = styleKey === 'long' ? 1920 : 1080;
  const h = styleKey === 'long' ? 1080 : 1920;
  const HIRAGINO = '/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc';
  const hasFonts = fs.existsSync(HIRAGINO);
  const fontArg  = hasFonts ? `:fontfile='${HIRAGINO.replace(/\\/g, '/').replace(/:/g, '\\:')}'` : '';

  const now   = new Date();
  const label = `${now.getFullYear()}年${now.getMonth() + 1}月 収益`;
  const mainFontSize  = Math.round(Math.min(h * 0.09, w * 0.10));  // cap at w*10% to fit 11-char strings within portrait canvas
  const labelFontSize = Math.round(h * 0.035);
  const noteFontSize  = Math.round(h * 0.028);
  const centerY = Math.round(h * 0.42);

  // カード風ボックスをFFmpegで描画
  const vf = [
    // 暗い背景グラデーション風（単色で代用）
    `drawbox=x=0:y=0:w=${w}:h=${h}:color=0x0d1117:t=fill`,
    // カード枠
    `drawbox=x=${Math.round(w*0.06)}:y=${Math.round(h*0.28)}:w=${Math.round(w*0.88)}:h=${Math.round(h*0.44)}:color=0x161b22:t=fill`,
    `drawbox=x=${Math.round(w*0.06)}:y=${Math.round(h*0.28)}:w=${Math.round(w*0.88)}:h=${Math.round(h*0.44)}:color=0x30363d:t=2`,
    // ラベル
    `drawtext=text='${label}'${fontArg}:fontsize=${labelFontSize}:fontcolor=0x8b949e:x=(w-text_w)/2:y=${Math.round(centerY - h*0.1)}`,
    // 区切り線
    `drawbox=x=${Math.round(w*0.12)}:y=${Math.round(centerY - h*0.02)}:w=${Math.round(w*0.76)}:h=2:color=0x30363d:t=fill`,
    // 収益数字（緑・大型）
    `drawtext=text='${proofNumber.replace(/'/g, "\\'")}'${fontArg}:fontsize=${mainFontSize}:fontcolor=0x3fb950:x=(w-text_w)/2:y=${centerY}:shadowcolor=0x000000@0.5:shadowx=2:shadowy=2`,
    // サブテキスト
    `drawtext=text='振込確認済み'${fontArg}:fontsize=${noteFontSize}:fontcolor=0x58a6ff:x=(w-text_w)/2:y=${Math.round(centerY + h*0.12)}`,
    // 下部ブランド
    `drawtext=text='ぬちょ AI副業ハック'${fontArg}:fontsize=${noteFontSize}:fontcolor=0x8b949e:x=(w-text_w)/2:y=${Math.round(h*0.82)}`,
  ].join(',');

  const { execa } = await import('execa');
  await execa('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', `color=size=${w}x${h}:rate=1:color=black`,
    '-vf', vf,
    '-frames:v', '1',
    '-q:v', '2',
    outPath,
  ]);
}

/** scene 1以降（コメントシーン）用のプロンプト生成 */
function buildCommentScenePrompt(text, type) {
  const ratio = resolveStyleKey(type) === 'short' ? 'vertical 9:16 portrait' : 'horizontal 16:9 landscape';

  // コメント・リアクション系キーワードを優先マッチ
  const commentVisuals = [
    { keys: ['笑える', '爆笑', '笑', 'ウケる'],
      en: 'person laughing at phone screen, hilarious reaction, casual and relatable' },
    { keys: ['怖い', '恐ろしい', 'ヤバい', 'やばい'],
      en: 'person with shocked or scared expression looking at computer screen' },
    { keys: ['共感', '同じ', 'わかる', 'だよね'],
      en: 'person nodding in agreement while looking at phone, relatable reaction' },
  ];

  for (const v of commentVisuals) {
    if (v.keys.some(k => text.includes(k))) {
      return `${ratio} YouTube background photo, ${v.en}, cinematic lighting, vibrant colors, no text overlays, no logos, high quality, 4K, photorealistic`;
    }
  }

  // デフォルト: SNS リアクション系
  return (
    `${ratio} YouTube background photo, person reacting to social media on phone, ` +
    `expression of surprise or laughter, casual home setting, ` +
    `cinematic lighting, vibrant colors, no text overlays, no logos, high quality, 4K, photorealistic`
  );
}

// 日本語シーンテキストをキーワード解析して内容に合った英語画像プロンプトを生成
const SCENE_VISUALS = [
  { keys: ['副業', '稼ぐ', '収入', '月10万', '月5万', 'お金', '稼ぎ', '報酬', '給料'],
    en: [
      'japanese person smiling at laptop, yen coins and bills, side income success, modern home office',
      'smartphone screen showing earnings dashboard with yen symbol, japanese apartment, success concept',
      'pile of japanese yen bills with laptop and notebook, financial growth, warm indoor lighting',
    ]},
  { keys: ['Claude', 'claude', 'Gemini', 'GPT', 'ChatGPT', 'OpenAI', '生成AI', 'LLM'],
    en: [
      'glowing AI assistant chat interface on dark screen, chat bubbles, futuristic blue glow',
      'smartphone displaying AI chatbot conversation with japanese text, modern clean desk setup',
      'AI brain neural network visualization, holographic interface, dark blue and cyan tones',
    ]},
  { keys: ['AI', 'エーアイ', '人工知能'],
    en: [
      'neural network nodes glowing, artificial intelligence concept, dark tech blue background',
      'robot hand and human hand interaction, AI collaboration concept, white clean background',
      'digital brain with circuit patterns, glowing gold and blue, futuristic technology art',
    ]},
  { keys: ['プログラミング', 'コード', 'コーディング', 'エンジニア', 'プログラマー'],
    en: [
      'bright clean IDE with colorful syntax highlighted code, modern coding setup, white theme',
      'multiple monitors showing dashboards and code, software development workspace, warm lighting',
      'terminal window with green code output, developer environment, dark but professional',
    ]},
  { keys: ['アプリ', 'スマホ', 'スマートフォン', 'モバイル'],
    en: [
      'hand holding smartphone showing clean minimal app UI, japanese interior background',
      'multiple app icons on phone screen, mobile app concept, colorful modern design',
      'smartphone flat lay on white desk, app interface visible, clean product shot',
    ]},
  { keys: ['ノーコード', 'No-Code', 'nocode', 'ローコード'],
    en: [
      'drag and drop visual workflow editor on screen, colorful blocks connected by arrows',
      'no-code builder interface with cards and modules, bright and approachable UI',
      'flowchart automation diagram, connected colorful nodes, clean white background',
    ]},
  { keys: ['初心者', '未経験', '誰でも', '簡単', '入門', '始め'],
    en: [
      'asian young person learning with laptop and notebook, enthusiastic expression, bright room',
      'step by step numbered guide on screen, beginner tutorial concept, clean infographic style',
      'lightbulb moment illustration, person with idea, bright warm colors, motivation concept',
    ]},
  { keys: ['案件', '仕事', 'クライアント', 'フリーランス', '受注'],
    en: [
      'freelancer at laptop in bright modern cafe, japanese style setting, professional success',
      'laptop screen showing contract or project dashboard, remote work concept, clean desk',
      'person closing a deal via laptop video call, professional, home office setup',
    ]},
  { keys: ['YouTube', 'ユーチューブ', '動画', '配信', 'チャンネル'],
    en: [
      'youtube analytics dashboard on screen, subscriber graph growing upward, creator success',
      'video editing timeline on monitor, content creator workspace, multiple screens',
      'ring light and camera setup, professional recording studio, clean creator space',
    ]},
  { keys: ['投資', 'NISA', '株', '資産', '運用', '利益'],
    en: [
      'stock market chart with upward trend, candlestick graph, financial success visualization',
      'japanese yen coins stacked on growth chart, investment concept, clean white background',
      'portfolio dashboard on screen showing growth metrics, financial data, modern minimal design',
    ]},
  { keys: ['自動', '自動化', 'ボット', 'スクリプト', '効率'],
    en: [
      'automated workflow with gears and arrows, efficiency concept, blue and white tech design',
      'robot and human working together, automation concept, bright modern illustration style',
      'timer and checkmarks, time saving and productivity, clean infographic concept',
    ]},
  { keys: ['Reddit', 'reddit', 'レディット'],
    en: [
      'social media feed on screen, viral post with many upvotes, online community discussion',
      'person reading interesting post on phone, surprised expression, casual home setting',
      'comment thread with many reactions, online discussion concept, screen glow',
    ]},
  { keys: ['海外', '世界', 'グローバル', '外国'],
    en: [
      'world map with glowing connection lines, global internet concept, blue and gold tones',
      'earth globe with digital network overlay, international technology, dark background',
      'passport and laptop, global freelance concept, travel and work lifestyle',
    ]},
  { keys: ['コメント', '反応', 'バズ', '話題', 'SNS', 'ネット'],
    en: [
      'smartphone screen with heart and like icons flooding in, social media success concept',
      'viral post notification bubbles, engagement metrics going up, colorful app interface',
      'person looking at phone with pleased smile, japanese interior, social media moment',
    ]},
  { keys: ['笑える', '爆笑', '笑', 'ウケる'],
    en: [
      'person laughing while looking at phone, hilarious reaction, bright casual setting',
      'group of friends laughing at something funny on screen, relatable social moment',
      'comedy reaction face illustration, surprised and amused expression, vibrant colors',
    ]},
  { keys: ['怖い', '恐ろしい', 'ヤバい', 'やばい'],
    en: [
      'person with shocked wide-yed expression at computer screen, dramatic lighting',
      'alarming warning notification on screen, red alert concept, high contrast',
      'surprised reaction looking at phone, dramatic moment, cinematic composition',
    ]},
];

// 違和感系 surreal/uncanny visuals — matched to buzz template strategy
// AI体験コンテンツ用ビジュアル — 「AIでここまでできる」を視覚的に体験させる
// 構造: AIデモ → AI比較 → AI裏側 → AI進化 → AIループ に対応
const UNCANNY_VISUALS = [
  // AIデモ型: AI生成と分からないクオリティの映像
  'hyperrealistic AI-generated japanese city street, photorealistic quality indistinguishable from real photography, perfect lighting, ultra-detailed, cinematic 9:16',
  'AI-generated portrait of japanese person, uncanny valley quality, skin too perfect, symmetrical features, subtle digital glow at edges, studio lighting',
  'photorealistic AI scene: tokyo intersection at night, neon reflections on wet pavement, impossible perfection, no real camera artifacts, generated world',
  // AI比較型: AIと現実の並列/混在
  'split screen comparison: left=real photo of japanese street, right=AI-generated same scene with subtle wrongness, photorealistic, side by side',
  'photorealistic scene where real and AI-generated elements blend — some objects too perfect, some normal, viewer cannot tell which is which',
  'before/after: original photograph on left, AI-enhanced or AI-replaced version on right, differences barely visible but present, cinematic',
  // AI裏側型: プロンプト/生成プロセスの可視化
  'dark futuristic interface showing AI prompt text glowing on screen, code and parameters visible, generation in progress, cyberpunk aesthetic, cinematic',
  'visualization of AI neural network generating an image — layers of abstraction becoming a photorealistic scene, dark blue background, glowing nodes',
  'computer screen showing AI image generation mid-process, half-formed photorealistic japanese cityscape emerging from noise, dramatic lighting',
  // AI進化型: 技術の進化を示す視覚
  'side by side comparison: blurry low-quality AI art from 2022 on left vs photorealistic AI image 2025 on right, dramatic quality difference, dark background',
  'timeline visualization of AI art evolution, pixelated to photorealistic progression, glowing gradient, tech aesthetic, cinematic 9:16',
  // AIループ型: シームレスなAI生成世界
  'infinite AI-generated corridor, each room perfectly identical yet subtly different, generated world looping, uncanny repetition, dark moody lighting',
  'circular japanese room where walls seamlessly repeat, AI-generated perfect symmetry, slightly wrong physics, loop structure visible, eerie atmosphere',
];

const FALLBACK_VISUALS = [
  'ai-generated japanese city at night, photorealistic quality, neon glow, indistinguishable from real photo, cinematic 9:16 vertical',
  'futuristic dark interface, AI generation visualization, glowing text and parameters, cyberpunk aesthetic, vertical portrait',
  'split comparison real vs AI-generated scene, side by side, barely visible differences, dramatic lighting, portrait orientation',
  'AI neural network visualization becoming photorealistic portrait, layers of abstraction, blue and purple tones, dark background',
  'photorealistic AI scene too perfect — no noise grain, impossible symmetry, generated world aesthetic, eerie cinematic atmosphere',
  'infinite corridor generated by AI, seamless loop structure, dark moody japanese interior, uncanny repetition, vertical 9:16',
];

function buildImagePrompt(text, type, index = 0) {
  const ratio = resolveStyleKey(type) === 'short' ? 'vertical 9:16 portrait' : 'horizontal 16:9 landscape';

  // Keyword-matched visuals for both short and long-form (content must match narration)
  for (const v of SCENE_VISUALS) {
    if (v.keys.some(k => text.includes(k))) {
      const options = Array.isArray(v.en) ? v.en : [v.en];
      const visualDesc = options[index % options.length];
      return (
        `${ratio} YouTube background photo, ${visualDesc}, ` +
        `cinematic lighting, vibrant colors, no text overlays, no logos, high quality, 4K, photorealistic`
      );
    }
  }

  const visualDesc = FALLBACK_VISUALS[index % FALLBACK_VISUALS.length];
  return `${ratio}, ${visualDesc}, no text overlays, no logos, no watermarks`;
}

// ── CLI 直接実行 ──────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [type, date] = process.argv.slice(2);
  runRender({ type: type ?? 'short', date });
}
