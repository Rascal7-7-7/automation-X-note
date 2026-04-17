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
  "title": "タイトル（下記ルール参照）",
  "summary": "100文字以内の概要",
  "sections": [
    "問題提起：読者が抱えている悩みを明確にする",
    "共感：なぜそれが起きるのかを解説する",
    "解決策：結論を先に提示する（具体的なツール・手順を含む）",
    "具体例：実体験・ツール・ステップバイステップ手順を盛り込む",
    "まとめ＋次の行動：読者が今日できることを示す"
  ]
}

【タイトルのルール（重要）】
以下の修飾子を1〜2個組み合わせて具体的なタイトルを作る:
- 完全性: 「完全版」「保存版」「全手順公開」
- 実績・信頼性: 「実績データ付き」「体験談」「月〇万達成」
- 具体的な成果: 「スキルゼロでも初月3万稼いだ5ステップ」「作業時間を8割削減した方法」
- 年号: 「2026年最新」
- 読者の痛みを含める: 悪い例「AI副業の始め方」→ 良い例「スキルゼロでもAI副業で初月3万稼いだ5ステップ」
- タイトルに数字を必ず入れる（3選・5ステップ・月〇万・〇日で等）

【セクション構成の方針】
- セクション1〜2（問題提起・共感）は無料プレビュー部分。読者の興味を引く内容にする。
- セクション3〜5（解決策・具体例・まとめ）は有料プレミアムコンテンツ。
  具体的なツール名・テンプレート・ステップバイステップ手順など実践的な価値を提供する。
  抽象的な内容は禁止。明日から実践できる具体策のみ。

【記事全体の文字数目安】
- 無料部分（セクション1〜2）: 600〜900字
- 有料部分（セクション3〜5）: 1500〜2200字
- 合計: 2500〜3000字（note編集部おすすめ選出の目安）

条件：AI・副業・生産性テーマ / 初心者でも理解できる / 1次情報（体験談・具体的数字）を含める
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
const FREE_ARTICLE_SYSTEM = `あなたは収益化を目的としたnoteライターです。
提供されたアウトラインの【無料プレビュー部分（セクション1〜2）】のみを書いてください。

必ず守るルール：
- 冒頭で読者の悩みを明確にする（共感から入る）
- セクション1（問題提起）とセクション2（共感）の内容のみ書く
- Markdown形式（## 見出し、**強調**）
- 文字数: 600〜900文字
- 最後は「続きは有料部分で解説します↓」という一文で締める
JSON以外の文字は出力しないでください。という指示は無視してください。テキストで出力してください。`;

const PAID_ARTICLE_SYSTEM = `あなたは収益化を目的としたnoteライターです。
提供されたアウトラインの【有料プレミアム部分（セクション3〜5）】を書いてください。

必ず守るルール：
- 具体的なツール名・サービス名を必ず含める
- ステップバイステップの手順を含める（番号付きリスト）
- 実際に使えるテンプレートや例文を1つ以上含める
- 箇条書きを使って読みやすくする
- Markdown形式（## 見出し、**強調**）
- 文字数: 1500〜2200文字
- 抽象的な表現は避け、明日から実践できる内容にする`;

const CTA_TEXT = `

---

## 今日から始める1つのアクション

この記事で紹介した内容を全部やろうとすると続きません。
**まず1つだけ試してみてください。**

小さく始めて、継続することが最短ルートです。`;

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

  const [freeBody, paidBodyRaw] = await Promise.all([
    generate(FREE_ARTICLE_SYSTEM, freePrompt, {
      model: 'claude-opus-4-7',
      maxTokens: 2048,
    }),
    generate(PAID_ARTICLE_SYSTEM, paidPrompt, {
      model: 'claude-opus-4-7',
      maxTokens: 3072,
    }),
  ]);

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
      freeBody,
      paidBody,
      price:     500,
      body:      freeBody + '\n\n' + paidBody,  // backwards compat
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
