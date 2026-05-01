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
import { launchBrowser, launchChromeProfileContext } from '../shared/browser-launch.js';
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
        const noteId = (d.noteUrl ?? '').match(/\/notes\/(n[a-z0-9]+)/)?.[1] ?? (d.noteUrl ?? '').match(/\/(n[a-z0-9]{8,})\/?/)?.[1];
        const editorUrl = toEditorUrl(d.noteUrl ?? '');
        if (!editorUrl) {
          logger.warn(MODULE, `cannot derive editor URL for ${d.title}`);
          continue;
        }
        // skip placeholders that are DONE (insertedAt present) or flagged for manual insertion
        const existing = (d.sectionImages ?? []).filter(s =>
          (s.imagePath && fs.existsSync(s.imagePath) && s.insertedAt) || s.requiresManualInsertion
        );
        const pending = placeholders.filter(p => !existing.find(e => e.placeholder.trim() === p.trim()));
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

// ── gpt-image-1 画像生成 ──────────────────────────────────────────
async function buildImagePrompt(description, articleTitle) {
  return generate(
    'Create a concise image generation prompt (English, max 250 chars) for a note.com Japanese blog article. ' +
    'Style: photorealistic or high-quality digital illustration. ' +
    'Warm natural lighting, professional photography feel. ' +
    'No text overlays, no UI chrome, no watermarks. No real human faces. ' +
    'Suitable for a Japanese lifestyle/side-hustle income blog.',
    `Article: ${articleTitle}\nImage needed: ${description}`,
    { maxTokens: 200 },
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

  const openai     = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imgPrompt  = await buildImagePrompt(description, articleTitle);
  logger.info(MODULE, `generating image [${idx}]: ${description.slice(0, 40)}`);
  logger.info(MODULE, `image prompt: ${imgPrompt.trim().slice(0, 120)}`);

  try {
    // gpt-image-1: photorealistic, returns base64
    const res = await openai.images.generate({
      model:          'gpt-image-1',
      prompt:         imgPrompt.trim(),
      n:              1,
      size:           '1536x1024',
      quality:        'high',
    });
    const b64 = res.data[0].b64_json;
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  } catch (err) {
    if (err.status === 403 || err.status === 404 || /model/i.test(err.message)) {
      logger.warn(MODULE, `gpt-image-1 unavailable (${err.message?.slice(0, 60)}) — falling back to dall-e-3`);
      const res = await openai.images.generate({
        model:           'dall-e-3',
        prompt:          imgPrompt.trim(),
        n:               1,
        size:            '1792x1024',
        quality:         'hd',
        response_format: 'url',
      });
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(outPath);
        https.get(res.data[0].url, r => {
          r.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', e => { fs.unlink(outPath, () => {}); reject(e); });
      });
    } else {
      throw err;
    }
  }

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
  const sessionFiles = { 1: '.note-session.json', 2: '.note-session-2.json', 3: '.note-session-3.json' };
  const sessionFile  = path.join(__dirname, '..', sessionFiles[accountId] ?? '.note-session.json');

  async function buildContext() {
    if (chromeProfile) {
      logger.info(MODULE, `trying Chrome profile: ${chromeProfile}`);
      try {
        const ctx = await launchChromeProfileContext(chromeProfile);
        const pg  = await ctx.newPage();
        await pg.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await pg.waitForTimeout(2_000);
        if (pg.url().includes('/login')) {
          await pg.waitForTimeout(2_500);
          await pg.getByRole('button', { name: 'ログイン' }).click().catch(() => {});
          await pg.waitForTimeout(5_000);
        }
        if (!pg.url().includes('/login')) return { context: ctx, page: pg, browser: null };
        logger.warn(MODULE, `Chrome profile "${chromeProfile}" not authenticated — falling back to session file`);
        await ctx.close();
      } catch (launchErr) {
        logger.warn(MODULE, `Chrome profile launch failed (${launchErr.message?.slice(0, 80)}) — falling back to session file`);
      }
    }
    // Session file fallback
    if (!fs.existsSync(sessionFile)) throw new Error(`no session file for acct${accountId}: ${sessionFile}`);
    const browser = await launchBrowser({ headless: true });
    const ctx = await browser.newContext({
      storageState: sessionFile,
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    return { context: ctx, page: await ctx.newPage(), browser };
  }

  logger.info(MODULE, `opening editor: ${editorUrl}`);
  const { context, page, browser } = await buildContext();

  try {
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_000);
    // Fast-fail if still on login page
    if (page.url().includes('/login')) {
      throw new Error(`acct${accountId} not authenticated — refresh session: node note/save-session.js`);
    }

    await takeDebugScreenshot(page, `article-${noteId}-before-editor-wait`);
    await page.waitForSelector('div.ProseMirror[role="textbox"]', { timeout: 35_000 });
    await page.waitForTimeout(1_500);
    await takeDebugScreenshot(page, `article-${noteId}-editor-ready`);

    const insertedImages = [];
    const failedImages   = [];
    for (let i = 0; i < generated.length; i++) {
      const { placeholder, imagePath } = generated[i];
      if (!imagePath) { logger.warn(MODULE, `no image for: ${placeholder}`); continue; }
      const ok = await insertImageAtPlaceholder(page, placeholder, imagePath, i);
      if (ok) {
        insertedImages.push({ placeholder, imagePath, insertedAt: new Date().toISOString() });
      } else {
        failedImages.push({ placeholder, imagePath });
      }
      await page.waitForTimeout(800);
    }

    if (insertedImages.length > 0) {
      await page.keyboard.press('Meta+s');
      await page.waitForTimeout(2_000);
      await takeDebugScreenshot(page, `article-${noteId}-saved`);
    }
    logger.info(MODULE, `${draft.title}: ${insertedImages.length}/${generated.length} images inserted`);

    return { insertedImages, failedImages };
  } finally {
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
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
      const { insertedImages, failedImages } = await processArticle(target);

      const hasChanges = insertedImages.length > 0 || failedImages.length > 0;
      if (hasChanges) {
        const prev = target.draft.sectionImages ?? [];
        // inserted: add with insertedAt
        // failed: mark requiresManualInsertion so next run skips them
        const manualEntries = failedImages.map(f => ({ ...f, requiresManualInsertion: true }));
        if (manualEntries.length > 0) {
          logger.warn(MODULE, `${target.draft.title}: ${manualEntries.length} image(s) need manual insertion`);
          for (const e of manualEntries) logger.warn(MODULE, `  ↳ ${e.imagePath}`);
        }
        const allNew = [...insertedImages, ...manualEntries];
        const merged = [
          ...prev.filter(p => !allNew.find(g => g.placeholder === p.placeholder)),
          ...allNew,
        ];
        const updated = { ...target.draft, sectionImages: merged };
        saveJSON(target.fp, updated);
        logger.info(MODULE, `draft updated: ${path.basename(target.fp)}`);
      }
    } catch (err) {
      logger.error(MODULE, `FAILED: ${target.draft.title}`, { message: err.message });
    }
  }

  logger.info(MODULE, 'all done');
}

main().catch(err => { logger.error(MODULE, 'fatal', { message: err.message }); process.exit(1); });
