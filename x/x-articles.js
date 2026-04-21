/**
 * X Articles 自動投稿モジュール
 *
 * フロー:
 *   1. 投稿済みnote記事からCTAリンクを取得
 *   2. Claude で長文記事コンテンツを生成（見出し・本文・CTA）
 *   3. DALL-E 3 でヘッダー画像を生成
 *   4. Playwright で X Articles エディタに入力して公開
 *   5. 公開URLをログに記録
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { generate } from '../shared/claude-client.js';
import { getXBrowser } from './browser-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE    = 'x:articles';
const POSTED_LOG = path.join(__dirname, 'queue/articles-posted.jsonl');
const NOTE_DRAFTS_DIR = path.join(__dirname, '../note/drafts');

// ── note URL 取得 ────────────────────────────────────────────────────

function getPostedNoteUrl() {
  if (!fs.existsSync(NOTE_DRAFTS_DIR)) return null;
  const files = fs.readdirSync(NOTE_DRAFTS_DIR).filter(f => f.endsWith('.json'));
  const posted = files
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(NOTE_DRAFTS_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(d => d?.status === 'posted' && d?.noteUrl?.includes('/n/'))
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  return posted[0] ?? null;
}

// ── Claude でArticle生成 ─────────────────────────────────────────────

const ARTICLE_SYSTEM = `副業・AI活用をテーマに、X Articlesの長文記事を生成してください。

【構成（厳守）】
1. タイトル（30〜50文字・クリックしたくなる数字入り）
2. リード文（3〜4行・読み手の悩みに刺さる）
3. セクション×3〜4個（各セクション: ##見出し + 本文4〜6行）
4. まとめ（3行）
5. CTA（note記事への誘導・自然な流れで）

【ルール】
- 実体験口調「やってみたら〜だった」
- 数字・具体例を必ず入れる
- AIツール名は直接主役にしない
- 全体で800〜1200文字
- note誘導は押しつけにならないよう自然に

出力形式（区切りは===）:
[タイトル]
===
[リード文]
===
[セクション1: ##見出し\n本文]
===
[セクション2: ##見出し\n本文]
===
[セクション3: ##見出し\n本文]
===
[まとめ]
===
[CTA文（noteリンクを {NOTE_URL} で示す）]`;

async function generateArticle(noteUrl, topic) {
  const prompt = `テーマ: ${topic}
note記事URL: ${noteUrl}

上記テーマで、X Articles用の長文記事を生成してください。
CTAではnote記事URL（{NOTE_URL}）を自然に誘導してください。`;

  const raw = await generate(ARTICLE_SYSTEM, prompt, {
    model:     'claude-sonnet-4-6',
    maxTokens: 2000,
  });

  const parts = raw.split(/\n===\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 6) throw new Error(`article generation incomplete: ${parts.length} parts`);

  const [rawTitle, lead, ...rest] = parts;
  const title = rawTitle.replace(/^\[タイトル\]\s*/m, '').trim();
  const cta  = rest.pop().replace(/{NOTE_URL}/g, noteUrl);
  const body = [lead, ...rest, cta].join('\n\n');

  return { title, body };
}

// ── DALL-E 3 でヘッダー画像生成 ──────────────────────────────────────

async function generateHeaderImage(title) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const imagePromptRaw = await generate(
    'Generate a concise DALL-E 3 prompt in English for a blog header image (16:9). Minimalist, professional, no text. Deep blue and white palette with gold accent.',
    `Article title (Japanese): ${title}`,
    { maxTokens: 150 },
  );

  const res = await openai.images.generate({
    model:           'dall-e-3',
    prompt:          imagePromptRaw.trim(),
    n:               1,
    size:            '1792x1024',
    quality:         'standard',
    response_format: 'url',
  });

  const imageUrl = res.data[0].url;
  const tmpPath  = path.join(__dirname, '../.tmp-article-header.png');
  await downloadToFile(imageUrl, tmpPath);
  return tmpPath;
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ── Playwright で X Articles に投稿 ─────────────────────────────────

async function postArticle({ title, body, imagePath }) {
  const { browser, page } = await getXBrowser({ headless: false });

  try {
    // ── Step1: 記事一覧ページで新規作成ボタンをクリック ────────────
    logger.info(MODULE, 'opening articles list');
    await page.goto('https://x.com/compose/articles', {
      waitUntil: 'domcontentloaded',
      timeout:   20_000,
    });
    await page.waitForTimeout(3_000);

    const createBtn = page.locator('button[aria-label="create"]').first();
    await createBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await createBtn.click();

    // エディタURLに遷移するまで待つ
    await page.waitForURL(/compose\/articles\/edit\//, { timeout: 15_000 });
    await page.waitForTimeout(2_000);
    logger.info(MODULE, `editor URL: ${page.url()}`);

    // ── Step2: タイトル入力 ──────────────────────────────────────
    const titleInput = page.locator('textarea[name="記事のタイトル"]');
    await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
    await titleInput.click();
    await titleInput.type(title, { delay: 20 });
    logger.info(MODULE, 'title entered');

    // ── Step3: 本文入力 ─────────────────────────────────────────
    const composer = page.locator('[data-testid="composer"]');
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
    await composer.click();
    await page.waitForTimeout(500);

    const bodyLines = body.split('\n');
    for (const line of bodyLines) {
      if (line.startsWith('## ')) {
        // 見出し: テキスト入力後に見出しボタン (btn-heading) があれば使う
        await page.keyboard.type(line.replace(/^##\s*/, ''), { delay: 12 });
        await page.keyboard.press('Enter');
      } else if (line === '') {
        await page.keyboard.press('Enter');
      } else {
        await page.keyboard.type(line, { delay: 10 });
        await page.keyboard.press('Enter');
      }
    }
    logger.info(MODULE, 'body entered');

    // ── Step4: 画像アップロード ─────────────────────────────────
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        const mediaBtn = page.locator('[aria-label="画像や動画を追加"]').first();
        if (await mediaBtn.count() > 0) {
          await mediaBtn.click();
          await page.waitForTimeout(1_000);
          const fileInput = page.locator('[data-testid="fileInput"]');
          await fileInput.setInputFiles(imagePath);
          await page.waitForTimeout(2_000);

          // 「メディアを編集」クロップダイアログが出るので「適用」で確定
          const applyBtn = page.locator('#layers button').filter({ hasText: '適用' }).first();
          const applied = await applyBtn.waitFor({ state: 'visible', timeout: 8_000 })
            .then(() => true).catch(() => false);
          if (applied) {
            await applyBtn.focus();
            await page.keyboard.press('Space');
            await page.waitForTimeout(1_500);
            logger.info(MODULE, 'image crop confirmed');
          } else {
            logger.warn(MODULE, 'crop dialog not found, proceeding');
          }
          logger.info(MODULE, 'image uploaded');
        } else {
          logger.warn(MODULE, 'media button not found, skipping image');
        }
      } catch (imgErr) {
        logger.warn(MODULE, `image upload failed: ${imgErr.message}`);
      }
    }

    // ── Step5: 公開 ────────────────────────────────────────────
    // X Articlesエディタは #layers mask が pointer events を遮断するため
    // page.evaluate で React synthetic event を直接発火する
    const publishBtn = page.locator('button:has-text("公開")').first();
    await publishBtn.waitFor({ state: 'visible', timeout: 10_000 });
    // focus + keyboard で公開ボタンを押す（#layers overlay を回避）
    await publishBtn.focus();
    await page.keyboard.press('Space');
    logger.info(MODULE, 'publish button activated via keyboard');

    // 「記事を公開」確認ダイアログが #layers に出るまで待つ
    const confirmBtn = page.locator('#layers button').filter({ hasText: '公開' }).first();
    const confirmed = await confirmBtn.waitFor({ state: 'visible', timeout: 6_000 })
      .then(() => true).catch(() => false);
    if (confirmed) {
      logger.info(MODULE, 'confirm dialog found, activating via keyboard');
      await confirmBtn.focus();
      await page.keyboard.press('Space');
    } else {
      logger.warn(MODULE, 'confirm dialog not found — checking if already published');
    }

    // 公開後のURL確定を待つ
    await page.waitForTimeout(5_000);
    const articleUrl = page.url();
    logger.info(MODULE, `article published: ${articleUrl}`);
    return articleUrl;
  } finally {
    await browser.close();
    if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  }
}

// ── トピック選択 ─────────────────────────────────────────────────────

const ARTICLE_TOPICS = [
  'AI副業で月5万円を達成するまでの具体的なステップ',
  'Claude Codeを使った作業自動化で残業ゼロになった話',
  '副業初心者がChatGPTとnoteで稼ぐための完全ロードマップ',
  'AIツールを使って副業収入を3倍にした5つの習慣',
  '会社員が副業で月10万円稼ぐためにやめたこと・始めたこと',
  '生成AIで副業記事を爆速で量産する方法【実績公開】',
];

function pickTopic() {
  if (!fs.existsSync(POSTED_LOG)) return ARTICLE_TOPICS[0];
  const posted = fs.readFileSync(POSTED_LOG, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  const usedTopics = new Set(posted.map(p => p.topic));
  const unused = ARTICLE_TOPICS.filter(t => !usedTopics.has(t));
  const pool = unused.length > 0 ? unused : ARTICLE_TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── エントリーポイント ─────────────────────────────────────────────

export async function runXArticle() {
  const noteData = getPostedNoteUrl();
  const noteUrl  = noteData?.noteUrl ?? 'https://note.com/rascal_ai_devops';
  const topic    = pickTopic();

  logger.info(MODULE, 'generating article', { topic, noteUrl });

  const { title, body } = await generateArticle(noteUrl, topic);
  logger.info(MODULE, 'article generated', { title, chars: body.length });

  let imagePath = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      imagePath = await generateHeaderImage(title);
      logger.info(MODULE, 'header image generated');
    } catch (err) {
      logger.warn(MODULE, `image generation failed: ${err.message}`);
    }
  }

  const articleUrl = await postArticle({ title, body, imagePath });

  fs.appendFileSync(
    POSTED_LOG,
    JSON.stringify({ topic, title, articleUrl, noteUrl, postedAt: new Date().toISOString() }) + '\n',
  );

  logger.info(MODULE, 'done', { articleUrl });
  return { articleUrl, title };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runXArticle().catch(err => { logger.error(MODULE, err.message); process.exit(1); });
}
