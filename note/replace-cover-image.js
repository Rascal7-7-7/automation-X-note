/**
 * Replace an existing cover image on a note.com article.
 * Usage: node note/replace-cover-image.js --account 1 --noteKey nd15b3ad263b3 --image .tmp-note-images/header-nd15b3ad263b3.png
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

async function shot(page, name) {
  const p = path.join(__dirname, '..', 'assets', 'note-accounts', `replace-${name}-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await page.screenshot({ path: p, fullPage: false });
  console.log('  screenshot:', p);
}

async function handleCropModal(page) {
  const crop = page.locator('.ReactModal__Overlay.CropModal__overlay, [class*="CropModal__overlay"]').first();
  if (await crop.count() === 0) return;
  console.log('  crop modal detected');
  await shot(page, 'crop');
  const btns = page.locator('.ReactModal__Content button');
  const n = await btns.count();
  const confirmTexts = ['保存', '完了', 'OK', '適用'];
  for (let i = 0; i < n; i++) {
    const txt = (await btns.nth(i).textContent() ?? '').trim();
    if (confirmTexts.some(t => txt.includes(t))) {
      await btns.nth(i).click({ force: true });
      await page.waitForTimeout(2_000);
      console.log(`  crop confirmed: "${txt}"`);
      return;
    }
  }
  await btns.last().click({ force: true });
  await page.waitForTimeout(2_000);
  console.log('  crop confirmed via last button');
}

async function main() {
  const { accountId, noteKey, imagePath } = parseArgs();
  if (!noteKey || !imagePath) {
    console.error('Usage: node note/replace-cover-image.js --account 1 --noteKey <key> --image <path>');
    process.exit(1);
  }
  const absImage = path.resolve(imagePath);
  if (!fs.existsSync(absImage)) { console.error('Image not found:', absImage); process.exit(1); }

  const account = ACCOUNTS[accountId];
  const sessionFile = path.join(__dirname, '..', account.session);
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ storageState: sessionFile });
  const page = await ctx.newPage();

  const url = `https://editor.note.com/notes/${noteKey}/edit/`;
  console.log('Opening:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await shot(page, 'before');

  // Check if cover image exists
  const coverImgInfo = await page.evaluate(() => {
    // Look for existing cover image container (note.com uses various class names)
    const selectors = [
      '[class*="eyecatch"]',
      '[class*="headerImage"]',
      '[class*="HeaderImage"]',
      '[class*="coverImage"]',
      '[class*="CoverImage"]',
      '[class*="header-image"]',
      '[class*="EyeCatch"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        return { found: true, selector: sel, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    // Fallback: look for the cover image itself (img inside the top 300px of editor area)
    const imgs = Array.from(document.querySelectorAll('img'));
    const topImg = imgs.find(img => {
      const r = img.getBoundingClientRect();
      return r.top < 300 && r.width > 200;
    });
    if (topImg) {
      const r = topImg.getBoundingClientRect();
      return { found: true, selector: 'img (fallback)', x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { found: false, x: 0, y: 0 };
  });

  // Scroll to top so cover image and × button are in viewport
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  console.log('cover area:', JSON.stringify(coverImgInfo));

  let uploaded = false;

  if (coverImgInfo.found) {
    // Hover over cover image to reveal change button
    await page.mouse.move(coverImgInfo.x, coverImgInfo.y);
    await page.waitForTimeout(800);
    await shot(page, 'hover');

    // Look for change/replace button that appears on hover
    const changeSelectors = [
      'button:has-text("変更")',
      'button:has-text("画像を変更")',
      'button:has-text("画像を追加")',
      '[aria-label*="変更"]',
      '[aria-label*="画像"]',
      'button:has-text("replace")',
    ];
    for (const sel of changeSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        console.log(`  found change button: ${sel}`);
        try {
          const [fc] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 3_000 }),
            btn.click(),
          ]);
          await fc.setFiles(absImage);
          await page.waitForTimeout(2_000);
          console.log('  uploaded directly');
          uploaded = true;
        } catch {
          // Submenu
          await page.waitForTimeout(500);
          const sub = page.locator('button:has-text("画像をアップロード"), button:has-text("ローカル")').first();
          if (await sub.count() > 0) {
            const [fc] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 5_000 }),
              sub.click(),
            ]);
            await fc.setFiles(absImage);
            await page.waitForTimeout(2_000);
            console.log('  uploaded via submenu after hover');
            uploaded = true;
          }
        }
        if (uploaded) break;
      }
    }
  }

  // Fallback: try clicking the cover image area directly
  if (!uploaded && coverImgInfo.found) {
    console.log('  trying direct click on cover area...');
    await page.mouse.click(coverImgInfo.x, coverImgInfo.y);
    await page.waitForTimeout(500);

    const coverBtns = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns
        .filter(b => b.textContent?.includes('変更') || b.textContent?.includes('画像'))
        .map(b => { const r = b.getBoundingClientRect(); return { text: b.textContent?.trim(), x: r.left + r.width/2, y: r.top + r.height/2 }; });
    });
    console.log('  cover area buttons after click:', coverBtns);
  }

  // Last resort: find × button on cover image and delete, then upload fresh
  if (!uploaded) {
    console.log('  trying to delete existing cover first...');
    if (coverImgInfo.found) {
      await page.mouse.move(coverImgInfo.x, coverImgInfo.y);
      await page.waitForTimeout(500);
    }

    // The × button is overlaid on the cover image — find via DOM traversal
    let deleted = false;
    // Try Playwright locators (auto-scrolls into view)
    const xSelectors = [
      'button:has-text("×")',
      'button:has-text("✕")',
      '[aria-label="削除"]',
      '[aria-label="remove"]',
      '[aria-label="close"]',
    ];
    for (const sel of xSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await btn.click({ force: true });
        await page.waitForTimeout(1_000);
        console.log(`  clicked delete btn: ${sel}`);
        deleted = true;
        break;
      }
    }

    if (deleted) {
      console.log('  cover image deleted');

      // Now try to add fresh
      const addBtn = page.locator('button[aria-label="画像を追加"]').first();
      if (await addBtn.count() > 0) {
        try {
          const [fc] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 3_000 }),
            addBtn.click(),
          ]);
          await fc.setFiles(absImage);
          await page.waitForTimeout(2_000);
          uploaded = true;
          console.log('  uploaded after delete');
        } catch {
          const sub = page.locator('button:has-text("画像をアップロード")').first();
          if (await sub.count() > 0) {
            const [fc] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 5_000 }),
              sub.click(),
            ]);
            await fc.setFiles(absImage);
            await page.waitForTimeout(2_000);
            uploaded = true;
            console.log('  uploaded via submenu after delete');
          }
        }
      }
    }
  }

  await handleCropModal(page);

  if (uploaded) {
    // Auto-save
    const saveBtn = page.locator('button:has-text("一時保存")').first();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await page.waitForTimeout(2_000);
      console.log('  saved');
    }
    console.log('✓ cover image replaced');
  } else {
    await shot(page, 'fail');
    console.log('⚠ could not replace cover image — check screenshot');
  }

  await shot(page, 'after');
  await browser.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
