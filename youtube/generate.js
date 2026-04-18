/**
 * YouTube コンテンツ生成
 *
 * フロー:
 *   1. youtube/queue/weekly_plan.json から今日のテーマ取得
 *      （なければ曜日ローテーション）
 *   2. type に応じて台本・タイトル・説明文・タグ・サムネイル文言を生成
 *      type: 'short' → 60秒以内の縦型ショート
 *      type: 'long'  → 10〜15分の長尺動画
 *   3. youtube/drafts/{date}/short.json または long.json に保存
 *
 * weekly_plan.json フォーマット:
 *   { "2026-04-14": { "theme": "AIツール活用術", "type": "short" } }
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const QUEUE_DIR  = path.join(__dirname, 'queue');
const MODULE     = 'youtube:generate';

// ── プロンプト ──────────────────────────────────────────────────────

// 5種のバズテンプレ — 違和感・AI暴露・ストーリー・ループ・比較
const SHORT_BUZZ_TEMPLATES = [
  { id: 1, name: '違和感系',   hook: 'この映像どこか変です',   cta: '気づきましたか？コメントで教えて' },
  { id: 2, name: 'AI暴露系',   hook: 'これ全部AIです',         cta: 'もう現実と区別つかない' },
  { id: 3, name: 'ストーリー系', hook: 'この世界にはルールがある', cta: '最後まで見て全部わかる' },
  { id: 4, name: 'ループ系',   hook: '最初から見直してください', cta: 'ループしてる？コメントで' },
  { id: 5, name: '比較系',     hook: 'AI vs 現実 どっちか当てて', cta: '答えはコメントで' },
];

const SHORT_SCRIPT_SYSTEM = `あなたはYouTubeショート動画（15秒以内）バイラルコンテンツ専門家です。

核心原則:「綺麗な映像は伸びない。意味+違和感+フックが伸びる」

【テンプレート（番号指定で選択）】
1. 違和感系: 「この映像どこか変です」→違和感シーン→異常増加→「気づきましたか？」
2. AI暴露系: 「これ全部AIです」→普通映像→現実崩壊→「もう区別つかない」
3. ストーリー系: 「この世界にはルールがある」→説明なし進行→違和感の伏線→最後で回収
4. ループ系: 違和感映像→展開→崩壊→最初に戻るループ
5. 比較系: 「AI vs 現実」→交互表示→判別不能→「答えはコメントで」

【絶対ルール】
- JSONのみ出力（説明・マークダウン不要）
- hookText: 0秒から表示するテロップ（12文字以内・インパクト最大化）
- script: 6要素の配列（1要素=1文、最大20文字、絵文字・記号禁止）
- scriptの構成: [フック継続, 違和感提示, 異常増加, 崩壊/展開, オチ/問いかけ, コメント誘導]

出力フォーマット（このJSONのみ）:
{"template":N,"hookText":"テキスト","script":["行1","行2","行3","行4","行5","行6"]}`;

const LONG_SCRIPT_SYSTEM = `あなたはYouTube長尺動画の構成・台本専門家です。
以下の条件で台本構成を作成してください：
- 尺: 10〜15分を想定
- フォーマット:
  [INTRO] 問題提起・価値提示（30〜60秒）
  [CHAPTER 1〜4] 各章タイトル + 要点3〜5箇条（各2〜3分）
  [OUTRO] まとめ + CTA（30秒）
- 各チャプターに【開始目安時刻】を付ける（例: 00:00, 01:30 ...）
- 話し言葉で自然に
出力: 台本構成テキストのみ`;

const TITLE_SYSTEM = `YouTubeのタイトル案を5個生成してください。
条件:
- 50文字以内（モバイル表示で全文見える上限）
- 主要キーワードを冒頭20文字以内に入れる（検索・アルゴリズム最重要）
- 「数字」「感情語」「意外性」の3要素のうち2つ以上を含む
- タイトルに #Shorts は入れない（説明文に入れる）
- クリック率（CTR）が高いパターン:
  「〇秒でわかる〇〇」「知らないと損する〇〇選」「月〇万稼いだ〇〇の全手順」
出力: 1〜5の番号付きリストのみ`;

const DESCRIPTION_SYSTEM = `YouTube動画の説明文を作成してください。
条件:
- 冒頭25語以内に主要キーワードを自然に含める（Google検索のmeta description扱い）
- 動画の価値・対象者・内容を3行以内に（「続きを読む」前に表示される部分）
- 本文300文字以上（短い説明文より検索ランキングが上がる）
- ハッシュタグは3〜5個のみ・説明文末尾に（関連度が高いものだけ厳選）
  ※10個以上はスパム判定のリスクあり。#Shorts を必ず含める（ショートの場合）
- チャンネル登録・SNSへの誘導文を末尾に
出力: 説明文テキストのみ`;

const THUMBNAIL_SYSTEM = `YouTubeサムネイル用のテキスト案と画像生成プロンプト（英語）を作成してください。
条件:
- テキスト案: 視聴者が思わずクリックする15文字以内のキャッチコピー3案
- 画像プロンプト: FLUX/Stable Diffusion向け英語プロンプト（16:9比率）
  - 鮮やかな背景色・大きなテキスト・驚き/喜びの表情（人物あり）
  - YouTubeサムネイルらしいデザイン
フォーマット:
COPY: [3案を改行区切り]
PROMPT: [英語プロンプト]`;

// ── サムネイル画像生成（Gemini Imagen） ─────────────────────────────

async function generateThumbnailImage(thumbnailText, draftDir) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn(MODULE, 'GEMINI_API_KEY not set — skipping thumbnail image generation');
    return null;
  }

  // サムネイルテキストから英語プロンプトを抽出
  const promptMatch = thumbnailText.match(/PROMPT:\s*(.+)/s);
  const imagePrompt = promptMatch
    ? promptMatch[1].trim()
    : `YouTube thumbnail, vibrant background, bold text, surprised expression, 16:9 ratio, professional design`;

  try {
    let GoogleGenAI;
    try {
      ({ GoogleGenAI } = await import('@google/genai'));
    } catch {
      logger.warn(MODULE, '@google/genai not installed — skipping thumbnail image generation');
      return null;
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: imagePrompt,
      config: { numberOfImages: 1, aspectRatio: '16:9' },
    });

    const imageData = response?.generatedImages?.[0]?.image?.imageBytes;
    if (!imageData) {
      logger.warn(MODULE, 'no image data returned from Gemini');
      return null;
    }

    const thumbnailPath = path.join(draftDir, 'thumbnail.png');
    fs.writeFileSync(thumbnailPath, Buffer.from(imageData, 'base64'));
    logger.info(MODULE, `thumbnail saved → ${thumbnailPath}`);
    return thumbnailPath;
  } catch (err) {
    logger.warn(MODULE, 'thumbnail image generation failed', { message: err.message });
    return null;
  }
}

// ── メイン ──────────────────────────────────────────────────────────

export async function runGenerate({ type, topic } = {}) {
  const today    = new Date().toISOString().split('T')[0];
  const { theme, videoType } = getTodayContent({ type, topic });

  logger.info(MODULE, `generating ${videoType} for theme: "${theme}"`);

  const draftDir = path.join(DRAFTS_DIR, today);
  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });

  const context = `テーマ: ${theme}\n動画タイプ: ${videoType === 'short' ? 'YouTubeショート（60秒以内）' : 'YouTube長尺動画（10〜15分）'}`;
  const scriptSystem = videoType === 'short' ? SHORT_SCRIPT_SYSTEM : LONG_SCRIPT_SYSTEM;

  const scriptModel = videoType === 'long' ? 'claude-opus-4-7' : 'claude-sonnet-4-6';

  // ショートはランダムテンプレ番号を渡してJSON出力を要求
  const templateId  = videoType === 'short'
    ? SHORT_BUZZ_TEMPLATES[Math.floor(Math.random() * SHORT_BUZZ_TEMPLATES.length)].id
    : null;
  const scriptContext = templateId
    ? `${context}\n使用テンプレート番号: ${templateId}`
    : context;

  const [rawScript, titles, description, thumbnail] = await Promise.all([
    generate(scriptSystem, scriptContext, {
      model: scriptModel,
      maxTokens: videoType === 'long' ? 3000 : 512,
    }),
    generate(TITLE_SYSTEM, context, { maxTokens: 512 }),
    generate(DESCRIPTION_SYSTEM, context, {
      model: scriptModel,
      maxTokens: 1024,
    }),
    generate(THUMBNAIL_SYSTEM, context, { maxTokens: 512 }),
  ]);

  // ショートはJSONパース → script文字列 + hookText 抽出
  let script = rawScript;
  let hookText = null;
  if (videoType === 'short') {
    try {
      const jsonMatch = rawScript.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        script   = Array.isArray(parsed.script) ? parsed.script.join('\n') : rawScript;
        hookText = parsed.hookText ?? SHORT_BUZZ_TEMPLATES[(templateId ?? 1) - 1]?.hook ?? null;
      }
    } catch {
      logger.warn(MODULE, 'short script JSON parse failed, using raw text');
    }
  }

  // タグ生成（説明文からハッシュタグを抽出）
  const tags = extractTags(description);

  // サムネイル画像生成（Gemini Imagen）
  const thumbnailPath = await generateThumbnailImage(thumbnail, draftDir);

  const draft = {
    theme,
    type: videoType,
    hookText,
    buzzTemplate: templateId,
    script,
    titles: parseTitles(titles),
    description,
    tags,
    thumbnail,
    thumbnailPath,
    date: today,
    status: 'ready',
    videoPath: null,      // 動画ファイルパス（upload時に設定）
    videoId: null,        // YouTube動画ID（upload後に設定）
    crossPublished: false,
    createdAt: new Date().toISOString(),
  };

  const draftPath = path.join(draftDir, `${videoType}.json`);
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  logger.info(MODULE, `draft saved → ${draftPath}`);

  return draft;
}

// ── ヘルパー ─────────────────────────────────────────────────────────

function getTodayContent({ type, topic } = {}) {
  const planFile = path.join(QUEUE_DIR, 'weekly_plan.json');
  const dayIndex = new Date().getDay();

  if (!type && !topic && fs.existsSync(planFile)) {
    try {
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const key  = new Date().toISOString().split('T')[0];
      if (plan[key]) {
        return {
          theme:     plan[key].theme ?? defaultTheme(dayIndex),
          videoType: plan[key].type  ?? 'short',
        };
      }
    } catch { /* fallback */ }
  }

  const defaults = [
    'AIツールで副業収益を上げる方法',
    'Claude Codeの使い方完全ガイド',
    '生成AIで作業を10倍速にする',
    'ChatGPTとClaudeの使い分け',
    'AI副業で月10万円稼ぐ仕組み',
    'おすすめAIツール厳選5選',
    'AI初心者が最初にやること',
  ];

  return {
    theme:     topic ?? defaults[dayIndex],
    videoType: type  ?? 'short',
  };
}

function defaultTheme(dayIndex) {
  const defaults = [
    'AIツールで副業収益を上げる方法',
    'Claude Codeの使い方完全ガイド',
    '生成AIで作業を10倍速にする',
    'ChatGPTとClaudeの使い分け',
    'AI副業で月10万円稼ぐ仕組み',
    'おすすめAIツール厳選5選',
    'AI初心者が最初にやること',
  ];
  return defaults[dayIndex];
}

function parseTitles(raw) {
  return raw
    .split('\n')
    .filter(l => /^\d[\.\)]/.test(l.trim()))
    .map(l => l.replace(/^\d[\.\)]\s*/, '').trim())
    .filter(Boolean);
}

function extractTags(description) {
  const matches = description.match(/#[\w\u3040-\u9FFF]+/g) ?? [];
  return [...new Set(matches.map(t => t.slice(1)))].slice(0, 15);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [type, ...rest] = process.argv.slice(2);
  const topic = rest.join(' ') || undefined;
  runGenerate({ type: type ?? 'short', topic });
}
