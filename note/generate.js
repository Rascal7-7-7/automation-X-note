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
import https from 'https';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { generate } from '../shared/claude-client.js';
import { generateWithReview } from '../shared/multi-persona-reviewer.js';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';
import { logNoteDraft } from '../analytics/logger.js';
import { getAccount } from './accounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:generate';

const HINTS_FILE = path.join(__dirname, '../analytics/reports/prompt-hints.json');

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
  "tags": ["タグ1", "タグ2", "タグ3", "タグ4", "タグ5", "タグ6", "タグ7", "タグ8", "タグ9", "タグ10"]
}

【tagsのルール】
- 5〜10個のハッシュタグ（#なし）
- 優先タグ（2026年トレンド）: 生成AI・AI副業・自動化ツール・AIエージェント・ChatGPT・Claude・GPT5・GEO・AIとやってみた・ChatGPT副業
- 安定タグ: 副業・ネット副業・お小遣い稼ぎ・フリーランス・記事・note
- エンゲージメントタグ: フォロバ100・相互フォロー
- 安定タグ × トレンドタグの組み合わせが最効果: 例「副業」×「生成AI」/「フリーランス」×「自動化ツール」
- 記事テーマに直結するものを優先。ブランドタグが指定された場合は必ず含める

【sectionsのルール】
- 必ず5要素の文字列配列にする
- 各要素は見出しテキストのみ（30文字以内）
- 構成: 問題提起 / 共感 / 解決策 / 具体例（数字・ツール名必須） / まとめ＋次の行動

【タイトルのルール（重要）】
- 文字数: 15〜25文字（note編集部選出基準）
- タイトル文頭に検索キーワードを配置:「AI副業」「Claude」「n8n」「ChatGPT」「副業」等
- 数字を必ず入れる（月〇万・〇ステップ・〇日で・〇選・〇%削減等）
- 固有名詞を入れる（Claude / n8n / ChatGPT / Notion等）
- ターゲットを明示（初心者・副業初心者・会社員・スキルゼロ等）
- 悪い例「AI副業の始め方」→ 良い例「Claude Codeで副業月3万、スキルゼロからの全手順」
- 勝ちパターン:「[キーワード]で[数字]、[ターゲット]が[行動/達成]した[方法/手順]」

条件：AI・副業・自動化テーマ / 初心者でも再現できる / 1次情報（自分の体験・具体的数字）必須
JSON以外の文字は出力しないでください。`;

async function generateOutline(theme, hintText, account) {
  const extra = account?.outlineExtra ? `\n\n【アカウント方向性】\n${account.outlineExtra}` : '';
  const personaExtra = account?.freeExtra
    ? `\n\n【N=1ペルソナ戦略】\n${account.freeExtra}\nこの1人に向けて徹底的に語りかける構成にする。「広い層向け」より「この1人の悩みを先読みして答える」構成が編集部選出・PV・CV率を上げる。`
    : '';
  const tagExtra = (() => {
    const parts = [];
    if (account?.brandTag) parts.push(`ブランドタグ（必ず含める）: ${account.brandTag}`);
    if (account?.preferredTags?.length) parts.push(`優先タグ候補（記事テーマに合うものを選ぶ）: ${account.preferredTags.join('・')}`);
    return parts.length ? `\n\n【アカウント固有タグ】\n${parts.join('\n')}` : '';
  })();
  const raw = await generate(
    OUTLINE_SYSTEM,
    `テーマ: ${theme}${hintText}${extra}${personaExtra}${tagExtra}`,
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
- 文字数: 800〜1200文字（短すぎると信頼されない）
- 【信頼ブロック必須】自分の実績・数値を証拠として1ブロック入れる:
  > 実際に試した期間・ツール名・具体的な数値変化（例: n8nを使い始めて2週間、投稿作業が1日2時間→15分に）
- 抽象的な表現は禁止。体験談・数字・ツール名で語る
- 読者が「自分でも再現できそう」と思う書き方にする
- 最後は「続きは有料部分で解説します↓」という一文で締める
- 【失敗・壁の記述必須】自分が実際につまずいたことを1つ入れる:
  > 試したがうまくいかなかったこと・エラー・想定外の失敗を具体的に（例: 最初の1週間は設定ミスで全自動投稿が失敗し続けた）
  成功事例だけの記事はAI生成感が強く読者に信頼されない
テキスト形式で出力してください。`;

const PAID_ARTICLE_SYSTEM = `あなたは収益化を目的としたnoteライターです。
提供されたアウトラインの【有料プレミアム部分（セクション3〜5）】を書いてください。

必ず守るルール：
- 具体的なツール名・サービス名（Claude / n8n / ChatGPT / xurl等）を必ず含める
- ステップバイステップの手順（番号付きリスト）を含める
- 実際に使えるプロンプト例文・設定コード・テンプレートを最低1つコードブロックで掲載:
  \`\`\`
  （実際のコード・プロンプト・設定値）
  \`\`\`
- コードは必ず上記の\`\`\`フェンスで囲む。コードをプレーンテキストで書いてはいけない
- Markdown形式（## 見出し、**強調**、| テーブル |）
- 文字数: 2500〜3500文字（3000字超でGoogle検索流入が発生する）
- 【証拠セクション必須】各セクションに1つ以上の証拠を入れる:
  - 数値比較: Before → After（例: 作業時間 90分 → 8分）
  - 実績数値: 収益額・フォロワー数・ビュー数など具体的な数字
- 【before/after表】少なくとも1つのセクションにMarkdownテーブルで比較表を作る:
  | 項目 | Before | After |
  |------|--------|-------|
  | ...  | ...    | ...   |
- 【画像プレースホルダー】各セクションの冒頭に画像の説明を1行挿入する（実際の画像は後で挿入）:
  > 📊 [ここに画像: 〇〇のスクリーンショット / フロー図 / グラフ]
- 読者が「これだけあれば完全再現できる」と感じる情報密度にする
- 抽象論禁止。全工程を手順として書く
- 【失敗セクション必須】有料部分の末尾近くに必ず以下のセクションを入れる:
  ## うまくいかなかったこと・ハマったポイント
  [具体的な失敗エピソード1〜2個 + 数値（失敗件数・時間・費用）] → [原因] → [対処法]
  このセクションがない記事はキュレーター選定対象外。AI生成コンテンツとの差別化の核心`;


// ── 画像生成 ─────────────────────────────────────────────────────

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function generateNoteImages(title, theme) {
  if (!process.env.OPENAI_API_KEY) return { headerImage: null, sectionImages: [] };

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const imgPromptRaw = await generate(
    'Generate a concise DALL-E 3 prompt in English for a note.com blog header image (16:9). Warm, professional, inviting style — soft gradients, light beige/cream tones with deep teal or indigo accents. Minimalist illustration style. No text, no people, no faces. Convey the theme through abstract shapes, icons, or scenes.',
    `Article title (Japanese): ${title}\nTheme: ${theme}`,
    { maxTokens: 150 },
  );

  const tmpDir = path.join(__dirname, '../.tmp-note-images');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const results = { headerImage: null, sectionImages: [] };

  try {
    const headerRes = await openai.images.generate({
      model: 'dall-e-3',
      prompt: imgPromptRaw.trim(),
      n: 1,
      size: '1792x1024',
      quality: 'standard',
      response_format: 'url',
    });
    const headerPath = path.join(tmpDir, `header-${Date.now()}.png`);
    await downloadToFile(headerRes.data[0].url, headerPath);
    results.headerImage = headerPath;
    logger.info(MODULE, `header image generated: ${headerPath}`);
  } catch (err) {
    logger.warn(MODULE, `header image generation failed: ${err.message}`);
  }

  return results;
}

const SECTION_PLACEHOLDER_RE = />\s*📊\s*\[ここに画像:([^\]]+)\]/g;

async function generateSectionImages(paidBody, title, ts) {
  if (!process.env.OPENAI_API_KEY) return [];
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tmpDir = path.join(__dirname, `../.tmp-note-images/article/${ts}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const descs = [];
  let m;
  const re = new RegExp(SECTION_PLACEHOLDER_RE.source, 'g');
  while ((m = re.exec(paidBody)) !== null) {
    const d = m[1].trim();
    if (!descs.includes(d)) descs.push(d);
  }
  if (!descs.length) return [];

  const results = [];
  for (let i = 0; i < descs.length; i++) {
    const desc = descs[i];
    const outPath = path.join(tmpDir, `section-${i}.png`);
    if (fs.existsSync(outPath)) {
      results.push({ placeholder: desc, imagePath: outPath });
      continue;
    }
    try {
      const promptRaw = await generate(
        'Create a concise DALL-E 3 prompt (English, ≤200 chars) for a note.com article body image. ' +
        'Style: professional infographic or diagram, light background, no faces, minimalist modern.',
        `Article: ${title}\nImage: ${desc}`,
        { maxTokens: 150 },
      );
      const res = await openai.images.generate({
        model: 'dall-e-3', prompt: promptRaw.trim(),
        n: 1, size: '1792x1024', quality: 'hd', response_format: 'url',
      });
      await downloadToFile(res.data[0].url, outPath);
      results.push({ placeholder: desc, imagePath: outPath });
      logger.info(MODULE, `section image [${i}] generated: ${outPath}`);
    } catch (err) {
      logger.warn(MODULE, `section image [${i}] failed: ${err.message}`);
      results.push({ placeholder: desc, imagePath: null });
    }
  }
  return results;
}


function buildCTA(account) {
  return `

---

## 今日から始める1つのアクション

この記事で紹介した内容を全部やろうとすると続きません。
**まず1つだけ試してみてください。**

小さく始めて、継続することが最短ルートです。

---

**${account.ctaLabel}。**
フォローすると実践記事が週3〜5本届きます。

→ [noteプロフィール](${account.ctaProfile})

詳細な設定・テンプレート・レポートは **有料マガジン** にまとめています。
プロフィールからご確認ください。`;
}

async function generateArticle(outline, account) {
  const freeSections = outline.sections.slice(0, 2);
  const paidSections = outline.sections.slice(2);

  const freeExtra = account?.freeExtra ? `\n対象読者補足: ${account.freeExtra}` : '';
  const paidExtra = account?.paidExtra ? `\n証拠・詳細補足: ${account.paidExtra}` : '';
  const personaExtra = account?.freeExtra
    ? `\n\n【N=1ペルソナ戦略（重要）】\n「${account.freeExtra}」この1人だけに語りかけるように書く。「皆さん」「多くの人が」は禁止。「あなたは〇〇で困っていませんか？」「あなたが今すぐできることは」のように直接語りかける文体にする。`
    : '';

  const freePrompt = `タイトル: ${outline.title}
概要: ${outline.summary}
無料プレビューのセクション:
${freeSections.map((s, i) => `${i + 1}. ${s}`).join('\n')}${freeExtra}${personaExtra}

上記セクションの本文を書いてください。最後は「続きは有料部分で解説します↓」で締めてください。`;

  const paidPrompt = `タイトル: ${outline.title}
概要: ${outline.summary}
有料コンテンツのセクション:
${paidSections.map((s, i) => `${i + 3}. ${s}`).join('\n')}${paidExtra}

上記セクションの本文を書いてください。具体的なツール・テンプレート・手順を必ず含めてください。`;

  const personaSet = account?.personaSet ?? 'note-tech';

  const [{ content: freeBody, review: freeReview }, paidBodyRaw, images] = await Promise.all([
    generateWithReview(
      (hint) => generate(FREE_ARTICLE_SYSTEM, freePrompt + (hint ? `\n\n改善指示:\n${hint}` : ''), { model: 'claude-opus-4-7', maxTokens: 2500 }),
      'note', personaSet,
    ),
    generate(PAID_ARTICLE_SYSTEM, paidPrompt, { model: 'claude-opus-4-7', maxTokens: 5120 }),
    generateNoteImages(outline.title, outline.summary),
  ]);
  logger.info(MODULE, `free section review score: ${freeReview.avgScore}`);

  const paidBody    = paidBodyRaw + buildCTA(account ?? { ctaLabel: 'AI活用・副業自動化の実践ノウハウを毎週公開', ctaProfile: 'https://note.com/rascal_ai_devops' });
  const ts          = Date.now();
  const sectionImages = await generateSectionImages(paidBody, outline.title, ts);

  return { freeBody, paidBody, images, freeReview, sectionImages };
}

export async function generatePaidBody(outline, accountId = 1) {
  const account = getAccount(accountId);
  const paidSections = outline.sections.slice(2);
  const paidExtra = account?.paidExtra ? `\n証拠・詳細補足: ${account.paidExtra}` : '';
  const personaExtra = account?.freeExtra
    ? `\n\n【N=1ペルソナ戦略（重要）】\n「${account.freeExtra}」この1人だけに語りかけるように書く。「皆さん」「多くの人が」は禁止。「あなたは〇〇で困っていませんか？」「あなたが今すぐできることは」のように直接語りかける文体にする。`
    : '';

  const paidPrompt = `タイトル: ${outline.title}
概要: ${outline.summary}
有料コンテンツのセクション:
${paidSections.map((s, i) => `${i + 3}. ${s}`).join('\n')}${paidExtra}${personaExtra}

上記セクションの本文を書いてください。具体的なツール・テンプレート・手順を必ず含めてください。`;

  const raw = await generate(PAID_ARTICLE_SYSTEM, paidPrompt, {
    model: 'claude-opus-4-7',
    maxTokens: 5120,
  });

  return raw + buildCTA(account);
}

// ── メイン ────────────────────────────────────────────────────────
export async function runGenerate(theme, accountId = 1) {
  const account   = getAccount(accountId);
  const DRAFTS_DIR = path.join(__dirname, account.draftsDir);
  const ideaQueue  = new FileQueue(path.join(__dirname, account.queueDir, 'ideas.jsonl'));

  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  const idea = theme ? null : await ideaQueue.shift();
  const resolvedTheme = theme ?? idea?.theme ?? null;

  if (!resolvedTheme) {
    logger.warn(MODULE, `[account:${accountId}] no theme available. run note:research first.`);
    return null;
  }

  try {
    logger.info(MODULE, `[account:${accountId}] generating: ${resolvedTheme}`);

    const hints    = loadHints();
    const hintText = buildHintText(hints);
    if (hintText) logger.info(MODULE, 'applying prompt hints');

    const outline = await generateOutline(resolvedTheme, hintText, account);
    logger.info(MODULE, 'outline done', { title: outline.title });

    const { freeBody, paidBody, images, freeReview, sectionImages } = await generateArticle(outline, account);

    const draft = {
      title:       outline.title,
      summary:     outline.summary,
      tags:        outline.tags ?? [],
      freeBody,
      paidBody,
      price:       account.price ?? null,
      body:        freeBody + '\n\n' + paidBody,
      theme:       resolvedTheme,
      angle:       idea?.angle ?? null,
      headerImage:   images?.headerImage ?? null,
      sectionImages: sectionImages ?? [],
      reviewScore:  freeReview?.avgScore ?? null,
      personaScores: freeReview?.scores ?? null,
      accountId,
      noteUrl:     account.noteUrl,
      createdAt:   new Date().toISOString(),
      status:      'draft',
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
  const [,, theme, accountId] = process.argv;
  runGenerate(theme, accountId ? Number(accountId) : 1);
}
