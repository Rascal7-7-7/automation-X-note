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
import { generateWithReview } from '../shared/multi-persona-reviewer.js';
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
  "title": "タイトル（下記ルール参照）",
  "summary": "100文字以内の概要",
  "sections": ["見出し1", "見出し2", "見出し3", "見出し4", "見出し5"],
  "tags": ["タグ1", "タグ2", "タグ3", "タグ4", "タグ5"]
}

【tagsのルール】
- 5個のハッシュタグ（#なし）
- AI・副業・生産性・Claude・自動化・収益化など記事テーマに合うキーワード

【sectionsのルール】
- 必ず5要素の文字列配列にする
- 各要素は見出しテキストのみ（30文字以内）
- 構成: 問題提起 / 共感 / 解決策 / 具体例 / まとめ＋次の行動

【タイトルのルール（重要）】
以下の修飾子を1〜2個組み合わせて具体的なタイトルを作る:
- 「完全版」「保存版」「月〇万達成」「2026年最新」など
- タイトルに数字を必ず入れる（3選・5ステップ・月〇万・〇日で等）
- 悪い例「AI副業の始め方」→ 良い例「スキルゼロでもAI副業で初月3万稼いだ5ステップ」

条件：AI・副業・生産性テーマ / 初心者でも理解できる / 1次情報（体験談・具体的数字）を含める
JSON以外の文字は出力しないでください。`;

async function generateOutline(theme, hintText) {
  const raw = await generate(
    OUTLINE_SYSTEM,
    `テーマ: ${theme}${hintText}`,
    { model: 'claude-sonnet-4-6', maxTokens: 1500 },
  );
  // コードブロック（```json ... ```）と生JSONの両パターンに対応
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('outline JSON not found in response');
  return JSON.parse(match[0]);
}

// ── 本文生成 ─────────────────────────────────────────────────────
const FREE_ARTICLE_SYSTEM = `あなたは収益化を目的としたnoteライターです。
提供されたアウトラインの【無料プレビュー部分（セクション1〜2）】のみを書いてください。

必ず守るルール：
- 冒頭で読者の悩みを明確にする（共感から入る）
- セクション1（問題提起）とセクション2（共感）の内容のみ書く
- Markdown形式（## 見出し、**強調**）
- 文字数: 600〜900文字
- 記事内でInstagramでの実践例を1〜2箇所自然に言及してください（例：「Instagramでこの方法を試したところ〜」「実際にInstagramのフォロワーに聞いてみると〜」）
- 最後は「続きは有料部分で解説します↓」という一文で締める
テキスト形式で出力してください。`;

const PAID_ARTICLE_SYSTEM = `あなたは収益化を目的としたnoteライターです。
提供されたアウトラインの【有料プレミアム部分（セクション3〜5）】を書いてください。

必ず守るルール：
- 具体的なツール名・サービス名を必ず含める
- ステップバイステップの手順を含める（番号付きリスト）
- 実際に使えるテンプレートや例文を1つ以上含める
- 箇条書きを使って読みやすくする
- Markdown形式（## 見出し、**強調**）
- 文字数: 1500〜2200文字
- 抽象的な表現は避け、明日から実践できる内容にする
- 記事内でInstagramでの実践例を1箇所自然に言及してください（例：「Instagramでこの手法を実際に投稿してみると〜」）`;

const CTA_TEXT = `

---

## 今日から始める1つのアクション

この記事で紹介した内容を全部やろうとすると続きません。
**まず1つだけ試してみてください。**

小さく始めて、継続することが最短ルートです。

---

この記事を書いた人のnoteをフォローすると、AI活用・副業に関する実践記事が週3回届きます。
ぜひプロフィールからフォローしてください 👆`;

async function generateArticle(outline) {
  const freeSections = outline.sections.slice(0, 2);
  const paidSections = outline.sections.slice(2);

  const freePrompt = `タイトル: ${outline.title}
概要: ${outline.summary}
無料プレビューのセクション:
${freeSections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

上記セクションの本文を書いてください。最後は「続きは有料部分で解説します↓」で締めてください。`;

  const paidPrompt = `タイトル: ${outline.title}
概要: ${outline.summary}
有料コンテンツのセクション:
${paidSections.map((s, i) => `${i + 3}. ${s}`).join('\n')}

上記セクションの本文を書いてください。具体的なツール・テンプレート・手順を必ず含めてください。`;

  const [{ content: freeBody, review: freeReview }, paidBodyRaw] = await Promise.all([
    generateWithReview(
      (hint) => generate(FREE_ARTICLE_SYSTEM, freePrompt + (hint ? `\n\n改善指示:\n${hint}` : ''), { model: 'claude-opus-4-7', maxTokens: 2048 }),
      'note', 'note-tech'
    ),
    generate(PAID_ARTICLE_SYSTEM, paidPrompt, {
      model: 'claude-opus-4-7',
      maxTokens: 3072,
    }),
  ]);
  logger.info('note:generate', `free section review score: ${freeReview.avgScore}`);

  const paidBody = paidBodyRaw + CTA_TEXT;

  return { freeBody, paidBody };
}

export async function generatePaidBody(outline) {
  const paidSections = outline.sections.slice(2);

  const paidPrompt = `タイトル: ${outline.title}
概要: ${outline.summary}
有料コンテンツのセクション:
${paidSections.map((s, i) => `${i + 3}. ${s}`).join('\n')}

上記セクションの本文を書いてください。具体的なツール・テンプレート・手順を必ず含めてください。`;

  const raw = await generate(PAID_ARTICLE_SYSTEM, paidPrompt, {
    model: 'claude-opus-4-7',
    maxTokens: 3072,
  });

  return raw + CTA_TEXT;
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

    const { freeBody, paidBody } = await generateArticle(outline);

    const draft = {
      title:     outline.title,
      summary:   outline.summary,
      tags:      outline.tags ?? [],
      freeBody,
      paidBody,
      price:     500,
      body:      freeBody + '\n\n' + paidBody,
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
