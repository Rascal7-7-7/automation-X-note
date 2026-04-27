/**
 * YouTube コミュニティ投稿生成（Posts タブ週3回）
 *
 * フロー:
 *   1. 直近の draft (short/long) からテーマ取得
 *   2. analytics/reports/prompt-hints.json から今日のトレンド取得
 *   3. 曜日ローテーションでポストタイプを選択
 *      月: 動画告知型 / 水: AI Tip型 / 金: エンゲージメント型
 *   4. Claude Haiku でコミュニティ投稿文を生成（150文字以内）
 *   5. youtube/queue/community-posts.jsonl に追記
 *
 * 実投稿: YouTube Data API は Community Posts 非対応のため手動 or Playwright(将来実装)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR  = path.join(__dirname, 'drafts');
const QUEUE_DIR   = path.join(__dirname, 'queue');
const HINTS_FILE  = path.join(__dirname, '../analytics/reports/prompt-hints.json');
const POSTS_LOG   = path.join(QUEUE_DIR, 'community-posts.jsonl');
const MODULE      = 'youtube:community-post';

// 月=0 水=2 金=4 (getDay: 0=Sun,1=Mon,...,5=Fri,6=Sat)
const POST_TYPE_BY_DAY = { 1: 'announce', 3: 'tip', 5: 'engagement' };

const SYSTEM = `あなたはYouTubeチャンネル「ぬちょ【AI副業ハック】」のコミュニティ投稿担当です。
AIを使った副業・自動化・生産性向上をテーマに発信しています。

ルール:
- 150文字以内（厳守）
- 絵文字を2〜3個使う
- 末尾に行動促進フレーズ（「チャンネル登録」「コメントで教えて」「詳細は最新動画で」のいずれか）
- 宣伝っぽくならず、読者にとって価値ある情報を添える`;

function getRecentDraft() {
  if (!fs.existsSync(DRAFTS_DIR)) return null;
  const dates = fs.readdirSync(DRAFTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  for (const date of dates.slice(0, 7)) {
    for (const type of ['short', 'long', 'reddit-short']) {
      const p = path.join(DRAFTS_DIR, date, `${type}.json`);
      if (fs.existsSync(p)) {
        try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      }
    }
  }
  return null;
}

function getTodayTopics() {
  if (!fs.existsSync(HINTS_FILE)) return [];
  try {
    const hints = JSON.parse(fs.readFileSync(HINTS_FILE, 'utf8'));
    return hints.topKeywords?.slice(0, 5) ?? [];
  } catch { return []; }
}

async function generatePost(postType, draft, topics) {
  const themeCtx = draft
    ? `直近の動画テーマ: ${draft.theme ?? draft.titles?.[0] ?? ''}` : '';
  const topicCtx = topics.length
    ? `今日のAIトレンドキーワード: ${topics.join('、')}` : '';

  const typeInstructions = {
    announce: `【動画告知型】直近アップした動画を告知しつつ、視聴者に「今すぐ見たい」と思わせるコミュニティ投稿を1件生成。`,
    tip:      `【AI Tip型】AIを使った副業・自動化に関する即実践できる1つのコツを、具体的ツール名（Claude/n8n/ChatGPT等）付きで投稿。`,
    engagement: `【エンゲージメント型】フォロワーが「コメントしたくなる」アンケートまたは質問形式の投稿。AI副業・自動化に関連するテーマで。`,
  };

  const prompt = `${typeInstructions[postType]}

${themeCtx}
${topicCtx}

投稿文のみ出力（前置き不要）。`;

  return generate(SYSTEM, prompt, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 256,
  });
}

export async function runCommunityPost() {
  const day = new Date().getDay();
  const postType = POST_TYPE_BY_DAY[day];

  if (!postType) {
    logger.info(MODULE, `no post scheduled for day=${day}`);
    return;
  }

  const draft  = getRecentDraft();
  const topics = getTodayTopics();

  logger.info(MODULE, `generating ${postType} post`, { theme: draft?.theme });

  const text = await generatePost(postType, draft, topics);

  if (!text || text.trim().length === 0) {
    logger.warn(MODULE, 'empty post generated, skipping');
    return;
  }

  const entry = JSON.stringify({
    type: postType,
    text: text.trim(),
    theme: draft?.theme ?? null,
    generatedAt: new Date().toISOString(),
    status: 'pending',
  });

  if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });
  fs.appendFileSync(POSTS_LOG, entry + '\n');
  logger.info(MODULE, 'community post saved', { type: postType, chars: text.trim().length });

  console.log('\n── YouTube コミュニティ投稿（手動投稿用） ──');
  console.log(text.trim());
  console.log(`文字数: ${text.trim().length}`);
  console.log('────────────────────────────────────────\n');

  return { type: postType, text: text.trim() };
}
