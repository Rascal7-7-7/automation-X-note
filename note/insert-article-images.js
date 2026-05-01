/**
 * note 記事内画像挿入スクリプト（レトロフィット + 自動化テスト）
 *
 * 投稿済み記事の「> 📊 [ここに画像: ...]」プレースホルダーを
 * DALL-E 3 HD 品質画像で自動置換する。
 *
 * 使い方:
 *   node note/insert-article-images.js            # 全未処理記事を処理
 *   node note/insert-article-images.js --dry-run  # 画像生成のみ（挿入なし）
 *
 * ⚠️ 実行前に Google Chrome を完全終了 (Cmd+Q) してください
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { launchChromeProfileContext } from '../shared/browser-launch.js';
import { getAccount } from './accounts.js';
import { generate } from '../shared/claude-client.js';
import { saveJSON } from '../shared/file-utils.js';
import { logger } from '../shared/logger.js';
import { takeDebugScreenshot, insertImageAtPlaceholder } from './post-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE    = 'note:insert-images';
const IMG_DIR   = path.join(__dirname, '../.tmp-note-images/article');
const DRY_RUN   = process.argv.includes('--dry-run');

const ACCOUNT_DRAFT_DIRS = {
  1: path.join(__dirname, 'drafts'),
  2: path.join(__dirname, 'drafts/account2'),
  3: path.join(__dirname, 'drafts/account3'),
};

// ── プレースホルダー抽出 ──────────────────────────────────────────
const PLACEHOLDER_RE = />\s*📊\s*\[ここに画像:([^\]]+)\]/g;

function extractPlaceholders(body) {
  const found = [];
  let m;
  while ((m = PLACEHOLDER_RE.exec(body)) !== null) {
    const desc = m[1].trim();
    if (!found.includes(desc)) found.push(desc);
  }
  return found;
}

// ── note エディタ URL 変換 ────────────────────────────────────────
function toEditorUrl(noteUrl) {
  // editor.note.com/notes/nXXX/publish/ → /edit/
  if (/editor\.note\.com/.test(noteUrl)) {
    return noteUrl.replace(/\/(publish|edit)\/?$/, '/edit/');
  }
  // note.com/username/n/nXXX → editor URL
  const m = noteUrl.match(/\/n\/(n[a-z0-9]+)/);
  if (m) return `https://editor.note.com/notes/${m[1]}/edit/`;
  return null;
}

// ── 投稿済み・プレースホルダーあり記事を収集 ────────────────────
function collectTargetDrafts() {
  const targets = [];
  for (const [acctId, dir] of Object.entries(ACCOUNT_DRAFT_DIRS)) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const fp = path.join(dir, file);
      try {
        const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (d.status !== 'posted') continue;
        const body = (d.paidBody ?? '') + (d.freeBody ?? '') + (d.body ?? '');
        const placeholders = extractPlaceholders(body);
        if (placeholders.length === 0) continue;
        const noteId = (d.noteUrl ?? '').match(/\/(n[a-z0-9]+)\/?/)?.[1];
        const editorUrl = toEditorUrl(d.noteUrl ?? '');
        if (!editorUrl) {
          logger.warn(MODULE, `cannot derive editor URL for ${d.title}`);
          continue;
        }
        // skip if already has sectionImages with paths
        const existing = (d.sectionImages ?? []).filter(s => s.imagePath && fs.existsSync(s.imagePath));
        const pending = placeholders.filter(p => !existing.find(e => e.placeholder === p));
        if (pending.length === 0) {
          logger.info(MODULE, `skip (all images done): ${d.title}`);
          continue;
        }
        targets.push({ fp, draft: d, accountId: Number(acctId), noteId, editorUrl, pending, existing });
      } catch { /* skip */ }
    }
  }
  return targets;
}

// ── DALL-E 3 画像生成 ─────────────────────────────────────────────
function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function buildDallePrompt(description, articleTitle) {
  return generate(
    'Create a concise DALL-E 3 prompt (English, max 200 chars) for a note.com blog in-article image. ' +
    'Style: clean professional infographic or diagram. Light background, modern minimalist. ' +
    'No real people faces. Simple icons and shapes are OK for flow diagrams. No UI chrome.',
    `Article: ${articleTitle}\nImage needed: ${description}`,
    { maxTokens: 150 },
  );
}

async function generateSectionImage(description, articleTitle, noteId, idx) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn(MODULE, 'OPENAI_API_KEY not set — skipping image generation');
    return null;
  }
  const outDir = path.join(IMG_DIR, noteId ?? 'unknown');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `section-${idx}.png`);
  if (fs.existsSync(outPath)) {
    logger.info(MODULE, `reuse existing: ${outPath}`);
    return outPath;
  }

  const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const dallePrompt = await buildDallePrompt(description, articleTitle);
  logger.info(MODULE, `generating image [${idx}]: ${description.slice(0, 40)}`);
  logger.info(MODULE, `dalle prompt: ${dallePrompt.trim().slice(0, 100)}`);

  const res = await openai.images.generate({
    model:           'dall-e-3',
    prompt:          dallePrompt.trim(),
    n:               1,
    size:            '1792x1024',
    quality:         'hd',       // HD品質
    response_format: 'url',
  });
  await downloadToFile(res.data[0].url, outPath);
  logger.info(MODULE, `saved: ${outPath}`);
  return outPath;
}

// ── Playwright: プレースホルダーを画像に置換 ────────────────────

// ── 1記事の処理 ───────────────────────────────────────────────────
async function processArticle({ fp, draft, accountId, noteId, editorUrl, pending }) {
  // 画像生成フェーズ
  const generated = [];
  for (let i = 0; i < pending.length; i++) {
    const imgPath = await generateSectionImage(pending[i], draft.title, noteId, i);
    generated.push({ placeholder: pending[i], imagePath: imgPath });
  }

  if (DRY_RUN) {
    logger.info(MODULE, `[dry-run] ${draft.title} — ${generated.length} images generated, skipping insertion`);
    return generated;
  }

  // Chrome起動・挿入フェーズ
  const { chromeProfile } = getAccount(accountId);
  if (!chromeProfile) {
    logger.warn(MODULE, `no chromeProfile for acct${accountId} — skipping insertion`);
    return generated;
  }

  logger.info(MODULE, `opening editor: ${editorUrl}`);
  const context = await launchChromeProfileContext(chromeProfile);
  const page    = await context.newPage();

  try {
    // Navigate to note.com first to establish auth context (cookie domain: note.com)
    await page.goto('https://note.com/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(1_500);
    if (page.url().includes('/login')) {
      // Try autofill login (Chrome profile has saved credentials)
      await page.getByRole('button', { name: 'ログイン' }).click().catch(() => {});
      await page.waitForTimeout(4_000);
      if (page.url().includes('/login')) {
        throw new Error(`Chrome profile "${chromeProfile}" not logged in to note.com — open Chrome and log in manually`);
      }
    }

    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_000);

    await page.waitForSelector('div.ProseMirror[role="textbox"]', { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await takeDebugScreenshot(page, `article-${noteId}-editor-ready`);

    let successCount = 0;
    for (let i = 0; i < generated.length; i++) {
      const { placeholder, imagePath } = generated[i];
      if (!imagePath) { logger.warn(MODULE, `no image for: ${placeholder}`); continue; }
      const ok = await insertImageAtPlaceholder(page, placeholder, imagePath, i);
      if (ok) successCount++;
      await page.waitForTimeout(800);
    }

    // Ctrl+S で保存
    await page.keyboard.press('Meta+s');
    await page.waitForTimeout(2_000);
    await takeDebugScreenshot(page, `article-${noteId}-saved`);
    logger.info(MODULE, `${draft.title}: ${successCount}/${generated.length} images inserted`);

    return generated;
  } finally {
    await context.close();
  }
}

// ── メイン ────────────────────────────────────────────────────────
async function main() {
  const targets = collectTargetDrafts();
  if (targets.length === 0) {
    logger.info(MODULE, 'no articles with pending image placeholders');
    return;
  }
  logger.info(MODULE, `${targets.length} articles to process${DRY_RUN ? ' [DRY RUN]' : ''}`);

  for (const target of targets) {
    logger.info(MODULE, `--- ${target.draft.title} (acct${target.accountId}) ---`);
    try {
      const generated = await processArticle(target);

      // draft JSON に sectionImages を保存
      const prev = target.draft.sectionImages ?? [];
      const merged = [
        ...prev.filter(p => !generated.find(g => g.placeholder === p.placeholder)),
        ...generated,
      ];
      const updated = { ...target.draft, sectionImages: merged };
      saveJSON(target.fp, updated);
      logger.info(MODULE, `draft updated: ${path.basename(target.fp)}`);
    } catch (err) {
      logger.error(MODULE, `FAILED: ${target.draft.title}`, { message: err.message });
    }
  }

  logger.info(MODULE, 'all done');
}

main().catch(err => { logger.error(MODULE, 'fatal', { message: err.message }); process.exit(1); });
