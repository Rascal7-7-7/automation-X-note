/**
 * note 記事生成モジュール
 * - note/queue/ideas.jsonl からテーマを取得
 * - Claude Sonnet で構成 → 本文の2段階生成
 * - analytics/reports/prompt-hints.json を参照して生成精度を向上
 * - drafts/ に保存
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import { logNoteDraft } from '../analytics/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:generate';

const DRAFTS_DIR   = path.join(__dirname, 'drafts');
const HINTS_FILE   = path.join(__dirname, '../analytics/reports/prompt-hints.json');
const ideaQueue    = new FileQueue(path.join(__dirname, 'queue/ideas.jsonl'));

// ── プロンプトヒント読み込み ──────────────────────────────────────
function loadHints() {
  try {
    if (fs.existsSync(HINTS_FILE)) {
      return JSON.parse(fs.readFileSync(HINTS_FILE, 'utf8'));
    }
  } catch { /* ヒントなしで続行 */ }
  return null;
}

function buildHintText(hints) {
  if (!hints) return '';
  const parts = [];
  if (hints.topKeywords?.length) {
    parts.push(`読者が反応しやすいキーワード: ${hints.topKeywords.join(', ')}`);
  }
  if (hints.effectivePatterns?.length) {
    parts.push(`効果的なパターン: ${hints.effectivePatterns.join(' / ')}`);
  }
  if (hints.weakPatterns?.length) {
    parts.push(`避けるべきパターン: ${hints.weakPatterns.join(' / ')}`);
  }
  if (hints.noteInsights?.preferNumbersInTitle) {
    parts.push('タイトルに数字を入れると読まれやすい傾向あり');
  }
  return parts.length ? `\n\n【過去データからのヒント】\n${parts.join('\n')}` : '';
}

// ── アウトライン生成 ──────────────────────────────────────────────
const OUTLINE_SYSTEM = `あなたは収益化を目的としたnoteライターです。
与えられたテーマで、日本人読者向けの記事アウトラインをJSONで作成してください。

必ず以下の構造を使ってください：
{
  "title": "クリックしたくなるタイトル（数字・具体性を含める）",
  "summary": "100文字以内の概要",
  "sections": [
    "問題提起：読者が抱えている悩みを明確にする",
    "共感：なぜそれが起きるのかを解説する",
    "解決策：結論を先に提示する",
    "具体例：実体験・ツール・手順を盛り込む",
    "まとめ＋次の行動：読者が今日できることを示す"
  ]
}

条件：
- AI・副業・生産性テーマ
- 初心者でも理解できる
- タイトルは「〇〇する方法」より「〇〇で△△した結果」のほうが強い
JSON以外の文字は出力しないでください。`;

async function generateOutline(theme, hintText) {
  const raw = await generate(
    OUTLINE_SYSTEM,
    `テーマ: ${theme}${hintText}`,
    { model: 'claude-sonnet-4-6', maxTokens: 512 },
  );
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('outline JSON not found in response');
  return JSON.parse(match[0]);
}

// ── 本文生成 ─────────────────────────────────────────────────────
const ARTICLE_SYSTEM = `あなたは収益化を目的としたnoteライターです。
提供されたアウトラインに従い、日本語で2000〜3000文字の記事本文を書いてください。

必ず守るルール：
- 冒頭で読者の悩みを明確にする（共感から入る）
- 途中に具体例・数字・ツール名を必ず入れる
- 箇条書きを使って読みやすくする
- 抽象的な表現は避け、明日から実践できる内容にする
- Markdown形式（## 見出し、**強調**）
- 最後の見出しは「まとめ」または「次のステップ」にする`;

const CTA_TEXT = `

---

## 今日から始める1つのアクション

この記事で紹介した内容を全部やろうとすると続きません。
**まず1つだけ試してみてください。**

小さく始めて、継続することが最短ルートです。`;

async function generateArticle(outline) {
  const prompt = `タイトル: ${outline.title}
概要: ${outline.summary}
構成:
${outline.sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

上記の構成で記事本文を書いてください。`;

  const body = await generate(ARTICLE_SYSTEM, prompt, {
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
  });

  return body + CTA_TEXT;
}

// ── メイン ────────────────────────────────────────────────────────
export async function runGenerate(theme) {
  const idea = theme ? null : await ideaQueue.shift();
  const resolvedTheme = theme ?? idea?.theme ?? null;

  if (!resolvedTheme) {
    logger.warn(MODULE, 'no theme available. run note:research first.');
    return null;
  }

  try {
    logger.info(MODULE, `generating: ${resolvedTheme}`);

    const hints    = loadHints();
    const hintText = buildHintText(hints);
    if (hintText) logger.info(MODULE, 'applying prompt hints');

    const outline = await generateOutline(resolvedTheme, hintText);
    logger.info(MODULE, 'outline done', { title: outline.title });

    const body = await generateArticle(outline);

    const draft = {
      title:     outline.title,
      summary:   outline.summary,
      body,
      theme:     resolvedTheme,
      angle:     idea?.angle    ?? null,
      createdAt: new Date().toISOString(),
      status:    'draft',
    };

    const filename  = `${Date.now()}-${outline.title.slice(0, 20).replace(/[\s/]/g, '_')}.json`;
    const draftPath = path.join(DRAFTS_DIR, filename);
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));

    logNoteDraft({
      title:     draft.title,
      theme:     draft.theme,
      summary:   draft.summary,
      draftPath,
    });

    logger.info(MODULE, `draft saved: ${draftPath}`);
    return draftPath;
  } catch (err) {
    logger.error(MODULE, 'generate failed', { message: err.message });
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runGenerate(process.argv[2]);
}
