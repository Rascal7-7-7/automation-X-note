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

const SHORT_SCRIPT_SYSTEM = `あなたはYouTubeショート動画の台本専門家です。
以下の条件で台本を作成してください：
- 尺: 60秒以内（読み上げ速度: 1分250〜300字）
- フォーマット: 冒頭3秒フック → 本編（箇条書き）→ CTA（チャンネル登録・コメント）
- 話し言葉で自然に（「〜です」「〜ます」調）
- 縦型（9:16）視聴を想定した簡潔な表現
出力: 台本テキストのみ`;

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
- 「数字」「感情語」「意外性」の3要素のうち2つ以上を含む
- 30文字以内を目安に
- クリック率（CTR）が高い表現
- ショート/ロング動画向けに最適化
出力: 1〜5の番号付きリストのみ`;

const DESCRIPTION_SYSTEM = `YouTube動画の説明文を作成してください。
条件:
- 冒頭3行以内にキーワードを含める（検索流入対策）
- 動画の価値・内容を簡潔に（200〜300字）
- ハッシュタグ10〜15個（関連度順）
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

// ── メイン ──────────────────────────────────────────────────────────

export async function runGenerate({ type, topic } = {}) {
  const today    = new Date().toISOString().split('T')[0];
  const { theme, videoType } = getTodayContent({ type, topic });

  logger.info(MODULE, `generating ${videoType} for theme: "${theme}"`);

  const draftDir = path.join(DRAFTS_DIR, today);
  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });

  const context = `テーマ: ${theme}\n動画タイプ: ${videoType === 'short' ? 'YouTubeショート（60秒以内）' : 'YouTube長尺動画（10〜15分）'}`;
  const scriptSystem = videoType === 'short' ? SHORT_SCRIPT_SYSTEM : LONG_SCRIPT_SYSTEM;

  const [script, titles, description, thumbnail] = await Promise.all([
    generate(scriptSystem, context, {
      model: 'claude-sonnet-4-6',
      maxTokens: videoType === 'long' ? 3000 : 1024,
    }),
    generate(TITLE_SYSTEM, context, { maxTokens: 512 }),
    generate(DESCRIPTION_SYSTEM, context, {
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
    }),
    generate(THUMBNAIL_SYSTEM, context, { maxTokens: 512 }),
  ]);

  // タグ生成（説明文からハッシュタグを抽出）
  const tags = extractTags(description);

  const draft = {
    theme,
    type: videoType,
    script,
    titles: parseTitles(titles),
    description,
    tags,
    thumbnail,
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
