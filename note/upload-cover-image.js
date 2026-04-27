/**
 * Upload cover images to already-published articles.
 * Usage: node note/upload-cover-image.js --account 1 --noteKey nd15b3ad263b3 --image .tmp-note-images/header-nd15b3ad263b3.png
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ACCOUNTS = {
  1: { session: '.note-session.json',   username: 'rascal_ai_devops' },
  2: { session: '.note-session-2.json', username: 'rascal_invest'    },
  3: { session: '.note-session-3.json', username: 'rascal_affiliate' },
};

function parseArgs() {
  const args = process.argv.slice(2);
  let accountId = 1, noteKey = null, imagePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--account' && args[i + 1]) accountId = Number(args[++i]);
    if (args[i] === '--noteKey' && args[i + 1]) noteKey = args[++i];
    if (args[i] === '--image'   && args[i + 1]) imagePath = args[++i];
  }
  return { accountId, noteKey, imagePath };
}

async function screenshot(page, name) {
  const p = path.join(__dirname, '..', 'assets', 'note-accounts', `cover-${name}-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await page.screenshot({ path: p });
  console.log('  screenshot:', p);
}

async function uploadCoverImage(page, imagePath) {
  const absPath = path.resolve(imagePath);
  if (!fs.existsSync(absPath)) {
    console.error('Image file not found:', absPath);
    return false;
  }

  // Check if cover image already set (look for existing thumbnail)
  const hasExisting = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="画像を追加"], [data-testid*="cover"]');
    if (!btn) return false;
    const img = btn.querySelector('img');
    return !!img;
  });
  if (hasExisting) {
    console.log('  cover image already set — skipping');
    return false;
  }

  // Auto-save before image upload
  const saveBtn = page.locator('button:has-text("一時保存")').first();
  if (await saveBtn.count() > 0) {
    await saveBtn.click();
    await page.waitForTimeout(2_000);
    console.log('  auto-saved');
  }

  // Find the topmost "画像を追加" button (cover image, not in-article)
  const allAddImgBtns = page.locator('button[aria-label="画像を追加"]');
  const count = await allAddImgBtns.count();
  if (count === 0) {
    console.log('  ⚠ no "画像を追加" button found');
    await screenshot(page, 'no-cover-btn');
    return false;
  }

  // Get bounding boxes to find topmost button
  let topmostBtn = null;
  let minY = Infinity;
  for (let i = 0; i < count; i++) {
    const btn = allAddImgBtns.nth(i);
    const box = await btn.boundingBox();
    if (box && box.y < minY) { minY = box.y; topmostBtn = btn; }
  }
  if (!topmostBtn) { console.log('  ⚠ could not determine topmost button'); return false; }

  console.log(`  clicking topmost "画像を追加" at y=${minY.toFixed(0)}`);

  // Try direct filechooser first (old behavior), then submenu
  let uploaded = false;
  try {
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 3_000 }),
      topmostBtn.click(),
    ]);
    await fc.setFiles(absPath);
    console.log('  uploaded directly via filechooser');
    uploaded = true;
  } catch {
    // Submenu appeared — look for upload option
    await page.waitForTimeout(500);
    const uploadOptions = [
      'button:has-text("画像をアップロード")',
      'button:has-text("ローカル")',
      'button:has-text("ファイルを選択")',
      '[role="menuitem"]:has-text("アップロード")',
    ];
    for (const sel of uploadOptions) {
      const item = page.locator(sel).first();
      if (await item.count() > 0) {
        try {
          const [fc] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 5_000 }),
            item.click(),
          ]);
          await fc.setFiles(absPath);
          console.log(`  uploaded via submenu: ${sel}`);
          uploaded = true;
          break;
        } catch (err2) {
          console.log(`  submenu ${sel} failed: ${err2.message}`);
        }
      }
    }
    if (!uploaded) {
      await page.keyboard.press('Escape');
      await screenshot(page, 'upload-fail');
    }
  }

  if (!uploaded) return false;
  await page.waitForTimeout(2_000);

  // Handle CropModal
  const cropOverlay = page.locator('.ReactModal__Overlay.CropModal__overlay, [class*="CropModal"]').first();
  if (await cropOverlay.count() > 0) {
    console.log('  crop modal detected');
    await screenshot(page, 'crop-modal');

    const cropBtns = page.locator('.ReactModal__Content button');
    const btnCount = await cropBtns.count();
    let cropDone = false;
    const confirmTexts = ['保存', '完了', 'OK', '適用', 'クロップ'];
    for (let i = 0; i < btnCount; i++) {
      const btn = cropBtns.nth(i);
      const txt = (await btn.textContent() ?? '').trim();
      if (confirmTexts.some(t => txt.includes(t))) {
        await btn.click({ force: true, timeout: 5_000 });
        await page.waitForTimeout(2_000);
        console.log(`  crop confirmed: "${txt}"`);
        cropDone = true;
        break;
      }
    }
    if (!cropDone) {
      // Click last button in modal (usually confirm)
      await cropBtns.last().click({ force: true });
      await page.waitForTimeout(2_000);
      console.log('  crop confirmed via last button');
    }

    // Reload to restore ProseMirror state from server auto-save
    console.log('  reloading editor after crop...');
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2_000);
  }

  return true;
}

async function saveArticle(page) {
  // Click 一時保存 to save the cover image
  const saveSelectors = ['button:has-text("一時保存")', 'button[aria-label*="保存"]'];
  for (const sel of saveSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(2_000);
      console.log('  article saved (一時保存)');
      return true;
    }
  }

  // If no 一時保存, try the publish update flow
  const publishBtn = page.locator('button:has-text("公開に進む"), button:has-text("設定して公開")').first();
  if (await publishBtn.count() > 0) {
    await publishBtn.click();
    await page.waitForTimeout(2_000);
    const confirmBtn = page.locator('button:has-text("公開する"), button:has-text("更新する")').first();
    if (await confirmBtn.count() > 0) {
      await confirmBtn.click();
      await page.waitForTimeout(3_000);
      console.log('  article updated via publish flow');
      return true;
    }
  }
  return false;
}

async function main() {
  const { accountId, noteKey, imagePath } = parseArgs();
  if (!noteKey || !imagePath) {
    console.error('Usage: node note/upload-cover-image.js --account 1 --noteKey <key> --image <path>');
    process.exit(1);
  }

  const account = ACCOUNTS[accountId];
  const sessionFile = path.join(__dirname, '..', account.session);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: sessionFile });
  const page = await context.newPage();

  const editorUrl = `https://editor.note.com/notes/${noteKey}/edit/`;
  console.log(`Opening: ${editorUrl}`);
  await page.goto(editorUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await screenshot(page, 'before');

  const uploaded = await uploadCoverImage(page, imagePath);
  if (uploaded) {
    await saveArticle(page);
    console.log('✓ Cover image uploaded and saved');
  } else {
    console.log('⚠ Cover image upload skipped or failed');
  }

  await screenshot(page, 'after');
  await browser.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
