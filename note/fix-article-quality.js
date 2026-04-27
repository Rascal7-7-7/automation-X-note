/**
 * 記事品質一括修正スクリプト
 * - カバー画像なし → DALL-E生成 + アップロード
 * - セクション画像なし → DALL-E生成 + ProseMirror挿入
 *
 * Usage:
 *   node note/fix-article-quality.js --account 2 --covers
 *   node note/fix-article-quality.js --account 2 --images
 *   node note/fix-article-quality.js --account 2 --covers --images
 *   node note/fix-article-quality.js --account 2 --covers --dry-run
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';
import { getAccount } from './accounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:fix-quality';

const args = process.argv.slice(2);
const ACCOUNT_ID = Number(args[args.indexOf('--account') + 1] ?? 1);
const DO_COVERS  = args.includes('--covers');
const DO_IMAGES  = args.includes('--images');
const DRY_RUN    = args.includes('--dry-run');

if (!DO_COVERS && !DO_IMAGES) {
  console.error('Usage: node note/fix-article-quality.js --account <1|2|3> [--covers] [--images] [--dry-run]');
  process.exit(1);
}

const SESSIONS = { 1: '.note-session.json', 2: '.note-session-2.json', 3: '.note-session-3.json' };
const DRAFT_DIRS = { 1: 'drafts', 2: 'drafts/account2', 3: 'drafts/account3' };

const TMP_DIR = path.join(__dirname, '../.tmp-note-images');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── ユーティリティ ───────────────────────────────────────────────

function noteKeyFromUrl(url = '') {
  return url.match(/notes\/(n[a-z0-9]+)/)?.[1]
      ?? url.match(/\/n\/(n[a-z0-9]+)/)?.[1]
      ?? null;
}

function loadDrafts(accountId) {
  const dir = path.join(__dirname, DRAFT_DIRS[accountId]);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const filePath = path.join(dir, f);
        const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { draft, filePath };
      } catch { return null; }
    })
    .filter(Boolean)
    .filter(({ draft }) => draft.status === 'posted' && draft.noteUrl);
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ── DALL-E 画像生成 ──────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateImage(prompt, outputName) {
  const dest = path.join(TMP_DIR, outputName);
  if (fs.existsSync(dest)) {
    logger.info(MODULE, `already exists: ${outputName}`);
    return dest;
  }
  if (DRY_RUN) {
    logger.info(MODULE, `[dry-run] would generate: ${outputName}`);
    return null;
  }
  logger.info(MODULE, `generating: ${outputName}`);
  const res = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1792x1024',
    quality: 'standard',
    response_format: 'url',
  });
  await downloadToFile(res.data[0].url, dest);
  logger.info(MODULE, `saved: ${dest}`);
  return dest;
}

async function buildCoverPrompt(title, theme) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Generate a concise DALL-E 3 image prompt (English, max 200 chars) for a note.com blog cover (16:9).
Style: dark gradient background (navy/indigo/teal), minimalist abstract illustration, professional Japanese tech blog, no text, no people, no faces, no logos.
Article title (Japanese): ${title}
Theme: ${theme}
Return only the prompt.`,
    }],
    max_tokens: 200,
  });
  return res.choices[0].message.content.trim();
}

async function buildSectionPrompt(sectionTitle, articleTitle) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Generate a concise DALL-E 3 image prompt (English, max 180 chars) for an inline section image in a Japanese blog article.
Style: clean diagram or concept illustration, light beige/cream background with deep teal or indigo accents, infographic or flow diagram aesthetic, no text, no people.
Section heading (Japanese): ${sectionTitle}
Article title (Japanese): ${articleTitle}
Return only the prompt.`,
    }],
    max_tokens: 180,
  });
  return res.choices[0].message.content.trim();
}

// ── カバー画像アップロード (Playwright) ─────────────────────────

async function uploadCoverToArticle(noteKey, imagePath, sessionFile) {
  if (DRY_RUN) {
    logger.info(MODULE, `[dry-run] would upload cover to ${noteKey}`);
    return true;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    const editorUrl = `https://editor.note.com/notes/${noteKey}/edit/`;
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_500);

    if (page.url().includes('/login')) {
      logger.error(MODULE, 'session expired', { noteKey });
      return false;
    }

    const coverBtn = page.locator('button[aria-label="画像を追加"]').first();
    if (await coverBtn.count() === 0) {
      logger.warn(MODULE, `${noteKey}: cover button not found (may already have cover)`);
      return false;
    }

    await coverBtn.click();
    await page.waitForTimeout(800);

    const uploadBtn = page.locator('button:has-text("画像をアップロード")').first();
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8_000 }),
      uploadBtn.click(),
    ]);
    await fileChooser.setFiles(imagePath);

    await page.waitForSelector('[data-testid="cropper"]', { timeout: 10_000 });
    const saveBtn = page.locator('button').filter({ hasText: /^保存$/ }).first();
    await saveBtn.click();
    await page.waitForTimeout(2_000);

    // 下書き保存して確定
    const IS_MAC = process.platform === 'darwin';
    await page.keyboard.press(IS_MAC ? 'Meta+s' : 'Control+s');
    await page.waitForTimeout(2_000);
    logger.info(MODULE, `cover uploaded: ${noteKey}`);
    return true;
  } finally {
    await browser.close();
  }
}

// ── セクション画像挿入 (Playwright + clipboard paste) ────────────

async function insertSectionImage(noteKey, headingText, imagePath, sessionFile) {
  if (DRY_RUN) {
    logger.info(MODULE, `[dry-run] would insert image after "${headingText}" in ${noteKey}`);
    return true;
  }

  const IS_MAC = process.platform === 'darwin';
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await ctx.newPage();
    await page.goto(`https://editor.note.com/notes/${noteKey}/edit/`, {
      waitUntil: 'domcontentloaded', timeout: 30_000,
    });
    await page.waitForTimeout(3_500);

    if (page.url().includes('/login')) {
      logger.error(MODULE, 'session expired', { noteKey });
      return false;
    }

    await page.waitForSelector('.ProseMirror', { timeout: 15_000 });

    // Step1: Selection API でカーソルを見出し末尾に置く
    const placed = await page.evaluate((hText) => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return false;
      let heading = Array.from(editor.querySelectorAll('h1,h2,h3,h4'))
        .find(h => h.textContent?.includes(hText));
      if (!heading) {
        heading = Array.from(editor.querySelectorAll('p,div'))
          .find(el => el.textContent?.trim().includes(hText));
      }
      if (!heading) return false;
      const range = document.createRange();
      range.selectNodeContents(heading);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      editor.focus();
      heading.scrollIntoView({ behavior: 'instant', block: 'center' });
      return true;
    }, headingText);

    if (!placed) {
      logger.warn(MODULE, `${noteKey}: heading not found: "${headingText}"`);
      return false;
    }

    await page.waitForTimeout(400);

    // Step2: Enter で空行を作る
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    // Step3: 画像をクリップボードに書き込んで貼り付け（最も確実な方法）
    const imgsBefore = await page.evaluate(() =>
      document.querySelectorAll('.ProseMirror img').length
    );

    const imageData = fs.readFileSync(imagePath).toString('base64');
    const mimeType  = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    await page.evaluate(async ({ data, mime }) => {
      const blob = await fetch(`data:${mime};base64,${data}`).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
    }, { data: imageData, mime: mimeType });

    await page.keyboard.press(IS_MAC ? 'Meta+v' : 'Control+v');
    await page.waitForTimeout(3_500);

    const imgsAfter = await page.evaluate(() =>
      document.querySelectorAll('.ProseMirror img').length
    );

    if (imgsAfter <= imgsBefore) {
      // フォールバック: hover "+" ボタン → メニュー → ファイルアップロード
      logger.warn(MODULE, `clipboard paste failed for ${noteKey}, trying "+" button...`);

      const editorLeft = await page.evaluate(() =>
        document.querySelector('.ProseMirror')?.getBoundingClientRect().left ?? 400
      );
      const cursorY = await page.evaluate(() => {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return 400;
        const r = sel.getRangeAt(0).getBoundingClientRect();
        return r.top + r.height / 2;
      });

      await page.mouse.move(Math.max(editorLeft - 45, 10), cursorY);
      await page.waitForTimeout(500);

      const plusCoords = await page.evaluate((approxY) => {
        const btns = Array.from(document.querySelectorAll('button,[role="button"]'));
        const leftBtns = btns.filter(b => {
          const r = b.getBoundingClientRect();
          return r.x < 350 && r.x > 0 && r.width > 10 && r.width < 60 && r.height > 10;
        });
        leftBtns.sort((a, b) => {
          const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
          return Math.abs(ar.top - approxY) - Math.abs(br.top - approxY);
        });
        const t = leftBtns[0];
        if (!t) return null;
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, cursorY);

      if (plusCoords) {
        await page.mouse.click(plusCoords.x, plusCoords.y);
        await page.waitForTimeout(700);

        for (const sel of ['button:has-text("画像をアップロード")', 'button:has-text("画像")']) {
          const item = page.locator(sel).first();
          if (await item.count() > 0) {
            try {
              const [fc] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5_000 }),
                item.click(),
              ]);
              await fc.setFiles(imagePath);
              await page.waitForTimeout(3_000);
              break;
            } catch { continue; }
          }
        }
      } else {
        logger.warn(MODULE, `${noteKey}: "+" button not found, skipping`);
        return false;
      }
    }

    // クロップモーダルが出た場合は確定
    const cropSave = page.locator('.ReactModal__Content button')
      .filter({ hasText: /保存|完了|OK/ }).first();
    if (await cropSave.count() > 0) {
      await cropSave.click();
      await page.waitForTimeout(1_500);
    }

    await page.keyboard.press(IS_MAC ? 'Meta+s' : 'Control+s');
    await page.waitForTimeout(2_000);
    logger.info(MODULE, `section image inserted after "${headingText}" in ${noteKey}`);
    return true;
  } finally {
    await browser.close();
  }
}

// ── メイン ───────────────────────────────────────────────────────

async function main() {
  const account    = getAccount(ACCOUNT_ID);
  const sessionFile = path.join(__dirname, '..', SESSIONS[ACCOUNT_ID]);
  const drafts     = loadDrafts(ACCOUNT_ID);

  logger.info(MODULE, `account ${ACCOUNT_ID} (${account.label}): ${drafts.length} posted articles`);

  const results = { coverFixed: [], coverSkipped: [], imageFixed: [], errors: [] };

  for (const { draft, filePath } of drafts) {
    const noteKey = noteKeyFromUrl(draft.noteUrl);
    if (!noteKey) {
      logger.warn(MODULE, `no noteKey for: ${draft.title?.slice(0, 40)}`);
      continue;
    }

    const shortTitle = draft.title?.slice(0, 50) ?? noteKey;
    logger.info(MODULE, `\n── ${shortTitle} (${noteKey}) ──`);

    // ── カバー画像 ────────────────────────────────────────────────
    if (DO_COVERS && !draft.headerImage) {
      try {
        const coverPrompt = await buildCoverPrompt(draft.title, draft.theme ?? draft.summary);
        const imgPath = await generateImage(coverPrompt, `cover-${noteKey}.png`);
        if (imgPath) {
          const ok = await uploadCoverToArticle(noteKey, imgPath, sessionFile);
          if (ok) {
            // ドラフトJSONを更新
            if (!DRY_RUN) {
              const updated = { ...draft, headerImage: imgPath };
              fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
            }
            results.coverFixed.push(noteKey);
          }
        }
      } catch (err) {
        logger.error(MODULE, 'cover fix failed', { noteKey, message: err.message });
        results.errors.push({ noteKey, phase: 'cover', error: err.message });
      }
    } else if (DO_COVERS && draft.headerImage) {
      logger.info(MODULE, `cover already set: ${noteKey}`);
      results.coverSkipped.push(noteKey);
    }

    // ── セクション画像 ───────────────────────────────────────────
    if (DO_IMAGES) {
      const body = (draft.freeBody ?? '') + '\n' + (draft.paidBody ?? '');
      const allHeadings = body.split('\n')
        .filter(l => /^#{2,3} /.test(l))
        .map(l => l.replace(/^#+\s*/, '').trim())
        .filter(Boolean);
      // 記事中盤の見出し（まとめ・CTA・冒頭除く）を対象に最大2枚
      const skip = /まとめ|CTA|今日から|フォロー|プロフィール/;
      const targetSections = allHeadings.filter(h => !skip.test(h)).slice(1, 3);

      for (const section of targetSections.slice(0, 2)) {
        try {
          const imgPrompt = await buildSectionPrompt(section, draft.title);
          const safeName  = section.replace(/[^\w぀-鿿]/g, '_').slice(0, 20);
          const imgPath   = await generateImage(imgPrompt, `section-${noteKey}-${safeName}.png`);
          if (imgPath) {
            const ok = await insertSectionImage(noteKey, section, imgPath, sessionFile);
            if (ok) results.imageFixed.push(`${noteKey}:${section}`);
          }
        } catch (err) {
          logger.error(MODULE, 'section image failed', { noteKey, section, message: err.message });
          results.errors.push({ noteKey, phase: 'section', section, error: err.message });
        }
      }
    }
  }

  // ── レポート ─────────────────────────────────────────────────
  console.log('\n========== 修正完了レポート ==========');
  console.log(`カバー修正: ${results.coverFixed.length}件`, results.coverFixed);
  console.log(`カバースキップ: ${results.coverSkipped.length}件`);
  console.log(`セクション画像: ${results.imageFixed.length}件`, results.imageFixed);
  if (results.errors.length) {
    console.log(`エラー: ${results.errors.length}件`, results.errors);
  }
  console.log('======================================');
}

main().catch(err => {
  logger.error(MODULE, 'article quality fix failed', { message: err.message });
  process.exit(1);
});
