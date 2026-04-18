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

// ── テロップカラーパレット（YPP 反復コンテンツ対策：動画ごとに変化） ──────────
// ASS カラー形式: &HAABBGGRR (アルファ・青・緑・赤)
const CAPTION_PALETTES = [
  { primary: '&H00FFFFFF', hook: '&H0000FFFF' }, // 白 / 黄
  { primary: '&H0000FFFF', hook: '&H00FFFFFF' }, // 黄 / 白
  { primary: '&H00F0F0F0', hook: '&H0010D0FF' }, // オフホワイト / オレンジ
];

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
    // ショート: 6シーン、duration は TTS 実測後に上書きされる（仮値 10s）
    return lines.slice(0, 6).map(text => ({
      text: text.slice(0, 40),
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
      if (scenes.length >= 20) break;
    }
    if (buffer && scenes.length < 20) {
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
      logger.info(MODULE, `scene image ${i + 1}/${scenes.length} generated`);
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
  if (type !== 'reddit-short' || !draft) return null;

  const imgPath = path.join(outDir, `${resolveStyleKey(type)}_scene_0.png`);
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
      'person with shocked wide-eyed expression at computer screen, dramatic lighting',
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

  // For shorts: use surreal/uncanny visuals that match the buzz template strategy
  if (resolveStyleKey(type) === 'short') {
    const visual = UNCANNY_VISUALS[index % UNCANNY_VISUALS.length];
    return `${ratio}, ${visual}, no text overlays, no logos, no watermarks`;
  }

  // For long-form: keyword-matched visuals from SCENE_VISUALS, then fallback
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

async function generateFallbackImage(outDir, index, type) {
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

// ── TTS 音声生成（edge-tts・シーン別） ───────────────────────────────
//
// 各シーンごとに個別 TTS を生成しシーン長にパディングして結合する。
// これにより映像・字幕・ナレーションの3つが完全に同期する。

async function generateTTS(scenes, outDir, type = 'short') {
  const prefix  = resolveStyleKey(type); // 'short' or 'long'
  const ttsPath = path.join(outDir, `${prefix}_tts.mp3`);
  const vttPath = path.join(outDir, `${prefix}_tts.vtt`);
  if (fs.existsSync(ttsPath)) return { ttsPath, vttPath: fs.existsSync(vttPath) ? vttPath : null };

  const voice     = 'ja-JP-NanamiNeural';
  // ショート: 自然なペース（+0%）、ロング系: わずかに速め（+10%）
  const ttsRate   = scenes.length <= 8 ? '+0%' : '+10%';
  // シーン間の無音（秒）— 読み上げ後に間を入れてテンポよく聞かせる
  const PAUSE_SEC = 1.2;

  const sceneTmps = [];
  const vttInfos  = [];
  let offset = 0;

  for (let i = 0; i < scenes.length; i++) {
    const rawMp3  = path.join(outDir, `tts_raw_${i}.mp3`);
    const rawVtt  = path.join(outDir, `tts_raw_${i}.vtt`);
    const padMp3  = path.join(outDir, `tts_pad_${i}.mp3`);
    sceneTmps.push(rawMp3, rawVtt, padMp3);

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

    vttInfos.push({ vttPath: rawVtt, offset });
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

async function generateKenBurnsClip(imgPath, duration, type, outPath, effectIdx) {
  const s      = STYLE[resolveStyleKey(type)];
  const fps    = 30;
  const frames = Math.round(duration * fps);
  // ズーム余裕1.2倍にスケールアップ→クロップして zoompan に渡す
  const W1 = Math.round(s.width  * 1.2);
  const H1 = Math.round(s.height * 1.2);
  const scaleCrop = `scale=${W1}:${H1}:force_original_aspect_ratio=increase,crop=${W1}:${H1}`;

  // scale=${s.width}:${s.height} を末尾に追加して出力解像度を強制固定
  const forceSize = `scale=${s.width}:${s.height}`;
  const effects = [
    // ズームイン（中央）
    `${scaleCrop},zoompan=z='1+0.1*(on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps},${forceSize}`,
    // 右パン（固定ズーム）
    `${scaleCrop},zoompan=z='1.08':x='iw*0.07*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps},${forceSize}`,
    // ズームアウト（中央）
    `${scaleCrop},zoompan=z='max(1.1-0.1*(on/${frames}),1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${s.width}x${s.height}:fps=${fps},${forceSize}`,
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

async function assembleVideo({ type, scenes, imagePaths, bgmPath, ttsPath, vttPath, outPath, hookText = null }) {
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
function convertSRTtoASS(srtPath, type, assPath, paletteIdx = 0, hookText = null) {
  const s            = STYLE[resolveStyleKey(type)];
  const W            = s.width;
  const H            = s.height;
  const fontSize     = Math.round(H * 0.026);         // ~50px（ショート）/ ~28px（ロング）— はみ出し防止
  const hookFontSize = Math.round(fontSize * 1.25);   // 冒頭フックは 1.25 倍
  const cardFontSize = Math.round(H * 0.045);         // CardHook: 画面中央の大きなテロップ
  const marginV      = Math.round(H * 0.22);          // 下端から 22%（YouTube Shorts UI の上）
  const marginLR     = Math.round(W * 0.05);
  const boxPad       = Math.round(fontSize * 0.35);
  const hookBoxPad   = Math.round(hookFontSize * 0.35);
  const cardBoxPad   = Math.round(cardFontSize * 0.4);

  const palette = CAPTION_PALETTES[paletteIdx % CAPTION_PALETTES.length];

  const assHeader = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // 通常字幕スタイル
    `Style: Default,Noto Sans JP,${fontSize},${palette.primary},&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,1,0,3,${boxPad},0,2,${marginLR},${marginLR},${marginV},1`,
    // 冒頭フック専用スタイル（大きめ・フック色・太字）
    `Style: Hook,Noto Sans JP,${hookFontSize},${palette.hook},&H000000FF,&H00000000,&HCC000000,1,0,0,0,100,100,1,0,3,${hookBoxPad},0,2,${marginLR},${marginLR},${marginV},1`,
    // CardHook: 画面中央に0〜2.5秒表示する大きなテロップ（generate.jsのhookText）
    `Style: CardHook,Noto Sans JP,${cardFontSize},&H00FFFFFF,&H000000FF,&H00000000,&HDD000000,1,0,0,0,100,100,2,0,3,${cardBoxPad},0,5,0,0,0,1`,
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
    const text = lines.slice(2).join(' ')
      .replace(/\{/g, '\\{').replace(/\}/g, '\\}');

    const isHook = blockIdx === 0;
    const style  = isHook ? 'Hook' : 'Default';
    // 冒頭フックは t=0 から表示（TTS タイミングに依存しない）
    const startTs = isHook ? '0:00:00.00' : srtTsToAss(startRaw);
    // フェードイン 250ms（視聴者の目を引く）
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
