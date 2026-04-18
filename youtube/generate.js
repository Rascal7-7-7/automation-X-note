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

// AI体験コンテンツ5テンプレ — バズ×フォロー両立設計
// 構造: 違和感(フック) → AI技術(価値) → 変化(エンタメ) → オチ(記憶)
const SHORT_BUZZ_TEMPLATES = [
  { id: 1, name: 'AIデモ型',  hook: 'これAIって気づいた？',      cta: '何個気づいた？コメントで' },
  { id: 2, name: 'AI比較型',  hook: 'AIか現実か当ててみて',       cta: '正解はもう一回見るとわかる' },
  { id: 3, name: 'AI裏側型',  hook: 'このAIの作り方教えます',     cta: '試した人コメントで教えて' },
  { id: 4, name: 'AI進化型',  hook: '今のAI、もう別次元です',     cta: 'どっちが好き？コメントで' },
  { id: 5, name: 'AIループ型', hook: 'このAI映像どこか変です',     cta: '何個気づいた？もう一回見て' },
];

const SHORT_SCRIPT_SYSTEM = `あなたはYouTube AIコンテンツクリエイターです。
アカウントコンセプト:「AIでここまでできる」を体験させる。バズ＋フォロー両立が目標。

【必須構造（秒数と内容を守れ）】
[0秒] AIフック — 断定で視聴者を止める。「これ全部AIで作ってます」
[1-2秒] 違和感映像 — ちょっとおかしい。視聴者が「ん？」と思う
[3秒] ツール/技術の価値情報 — 「実は◯◯を使ってます」形式で具体的に
[4-6秒] 異常強化 — 「もう現実と区別つきません」レベルに引き上げ
[7-9秒] 崩壊 or ループ — 世界が壊れるか最初に戻る
[10秒] コメント誘導CTA — 「どうやって作ったと思う？」「気づいた？」

【テンプレート別構成】
1. AIデモ型: 「これ全部AIです」→違和感→「Runwayを使ってます」→異常→崩壊→「どう作ったと思う？」
2. AI比較型: AI映像→現実映像→「どっちかわかる？」→混在→判別不能→「正解コメントで」
3. AI裏側型: 「プロンプトはこれ」→生成→違和感→異常→「誰でも作れます」→「試した？」
4. AI進化型: 去年AI→今AI→差異拡大→「もう別物です」→最新ツール名→「どっちが好き？」
5. AIループ型: AI生成世界→違和感→異常→「気づいてください」→ループ→「もう一回見て」

【AIツール名の使い方（重要）】
- script[2]はツール名のみの短い行にする（最大10文字）
- 形式: 「Runwayで生成」「Claude使用」「Stable Diffusion」
- 使用可能ツール: Runway Gen-4 / Stable Diffusion / Midjourney / Gemini / Sora / Kling / Claude
- ツール名が長い場合は短縮してよい（「Runway使用」等）

【絶対ルール】
- JSONのみ出力（説明・マークダウン不要）
- hookText: 12文字以内・「これAIって気づいた？」形式が最強（AI疑問形）
- script: 6要素の配列（絵文字・記号禁止）
  - script[0]: 最大16文字（AI暴露フック継続）
  - script[1]: 最大16文字（違和感Lv1）
  - script[2]: 最大10文字（AIツール名のみ。例:「Runwayで生成」）
  - script[3]: 最大16文字（違和感Lv2→異常）
  - script[4]: 最大16文字（崩壊 or ループ。必須）
  - script[5]: 最大14文字（「何個気づいた？」「もう一回見て」のどちらか必須）

出力フォーマット（このJSONのみ）:
{"template":N,"hookText":"テキスト","script":["行1","行2","行3","行4","行5","行6"]}`;

const LONG_SCRIPT_SYSTEM = `あなたはYouTube AIコンテンツクリエイターです。
アカウントコンセプト:「AIでここまでできる」を体験させる。バズ×学び×フォロー獲得が目標。

【必須6フェーズ構成】
[HOOK 0:00〜0:05] AI暴露 + 価値明言 — 「この映像、全部AIです。今日はAIの限界を見せます」
[PHASE 1 〜0:30] 普通に見せる — ぱっと見は現実と区別つかない。違和感を静かに仕込む
[PHASE 2 〜1:00] AI価値提供 — ツール名を明示 + 「なぜこれがすごいか」を30秒で解説（学び）
[PHASE 3 〜3:00] 制作過程を一瞬見せる — 「このシーン、実は[技術]で作ってます」裏側を開示
[PHASE 4 〜8:00] 異常 → 崩壊 — 違和感が限界を超える。仕込んだ伏線を全部回収
[OUTRO 〜10:00] 強い一言で締める — 「これ、全部AIです」→ 「何個気づいた？コメントで」→ ループ誘導

【各フェーズのルール】
- HOOK: 「この動画は[AIツール名]で作りました。AIの限界を今日見せます」形式
- PHASE2: 必ず具体的AIツール名 + 「なぜすごいか」1〜2文（視聴者の"どうやるの？"を引き出す）
- PHASE3: 「このシーン、実は[技術的説明]」で制作過程を一瞬だけ開示（全部教えない→続きはフォロー）
- PHASE4: 伏線を全部回収してから崩壊。「最初のシーンを思い出してください」で繋げる
- OUTRO: 「これ、全部AIです」の強い一言 → 「何個気づいた？」CTA → 「最初から見るともっとわかります」ループ誘導

- 話し言葉で自然に
- 各フェーズに【開始目安時刻】を付ける
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
  const { theme, videoType, series, episode, template: planTemplate, aiTool } = getTodayContent({ type, topic });

  logger.info(MODULE, `generating ${videoType} for theme: "${theme}"${series ? ` [${series} #${episode}]` : ''}`);

  const draftDir = path.join(DRAFTS_DIR, today);
  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });

  const seriesLabel = series && episode ? `\nシリーズ: ${series} #${episode}` : '';
  const aiToolLabel = aiTool ? `\n使用AIツール: ${aiTool}` : '';
  const context = `テーマ: ${theme}\n動画タイプ: ${videoType === 'short' ? 'YouTubeショート（60秒以内）' : 'YouTube長尺動画（10〜15分）'}${seriesLabel}${aiToolLabel}`;
  const scriptSystem = videoType === 'short' ? SHORT_SCRIPT_SYSTEM : LONG_SCRIPT_SYSTEM;

  const scriptModel = videoType === 'long' ? 'claude-opus-4-7' : 'claude-sonnet-4-6';

  // planで指定があればそれを使う、なければランダム
  const templateId = videoType === 'short'
    ? (planTemplate ?? SHORT_BUZZ_TEMPLATES[Math.floor(Math.random() * SHORT_BUZZ_TEMPLATES.length)].id)
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
      // strip markdown fences, then extract balanced JSON object
      const stripped = rawScript.replace(/```[a-z]*\n?/g, '').trim();
      const start = stripped.indexOf('{');
      if (start !== -1) {
        let depth = 0, end = -1;
        for (let i = start; i < stripped.length; i++) {
          if (stripped[i] === '{') depth++;
          else if (stripped[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end !== -1) {
          const parsed = JSON.parse(stripped.slice(start, end + 1));
          script   = Array.isArray(parsed.script) ? parsed.script.join('\n') : rawScript;
          hookText = parsed.hookText ?? SHORT_BUZZ_TEMPLATES[(templateId ?? 1) - 1]?.hook ?? null;
        }
      }
    } catch (e) {
      logger.warn(MODULE, `short script JSON parse failed: ${e.message}`);
      hookText = SHORT_BUZZ_TEMPLATES[(templateId ?? 1) - 1]?.hook ?? null;
    }
  }

  // タグ生成（説明文からハッシュタグを抽出）
  const tags = extractTags(description);

  // サムネイル画像生成（Gemini Imagen）
  const thumbnailPath = await generateThumbnailImage(thumbnail, draftDir);

  const draft = {
    theme,
    type: videoType,
    series:      series  ?? null,
    episode:     episode ?? null,
    aiTool:      aiTool  ?? null,
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
        const entry = plan[key];
        return {
          theme:     entry.theme     ?? defaultTheme(dayIndex),
          videoType: entry.type      ?? 'short',
          series:    entry.series    ?? null,
          episode:   entry.episode   ?? null,
          template:  entry.template  ?? null,
          aiTool:    entry.aiTool    ?? null,
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
    series:    null,
    episode:   null,
    template:  null,
    aiTool:    null,
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
