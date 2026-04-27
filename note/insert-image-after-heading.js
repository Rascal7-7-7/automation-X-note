/**
 * Insert an image after a specific heading in a note.com article.
 * Strategy: find the element immediately after the target heading in ProseMirror,
 * click its block-add "+" button (left margin), select image, upload.
 *
 * Usage:
 *   node note/insert-image-after-heading.js --account 1 --noteKey nd15b3ad263b3 --heading "解決策" --image .tmp-note-images/article/nd15b3-img1.png
 *   node note/insert-image-after-heading.js --all
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ACCOUNTS = {
  1: { session: '.note-session.json' },
  2: { session: '.note-session-2.json' },
  3: { session: '.note-session-3.json' },
};

function parseArgs() {
  const args = process.argv.slice(2);
  let accountId = 1, noteKey = null, heading = null, imagePath = null, all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--account' && args[i + 1]) accountId = Number(args[++i]);
    if (args[i] === '--noteKey' && args[i + 1]) noteKey = args[++i];
    if (args[i] === '--heading' && args[i + 1]) heading = args[++i];
    if (args[i] === '--image'   && args[i + 1]) imagePath = args[++i];
    if (args[i] === '--all') all = true;
  }
  return { accountId, noteKey, heading, imagePath, all };
}

async function shot(page, name) {
  const p = path.join(__dirname, '..', 'assets', 'note-accounts', `insert-${name}-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await page.screenshot({ path: p });
  return p;
}

async function handleCropModal(page) {
  await page.waitForTimeout(1_000);
  const crop = page.locator('.ReactModal__Overlay.CropModal__overlay, [class*="CropModal__overlay"]').first();
  if (await crop.count() === 0) return;
  console.log('  crop modal detected');
  const btns = page.locator('.ReactModal__Content button');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const txt = (await btns.nth(i).textContent() ?? '').trim();
    if (['保存', '完了', 'OK', '適用'].some(t => txt.includes(t))) {
      await btns.nth(i).click({ force: true });
      await page.waitForTimeout(2_000);
      console.log(`  crop confirmed: "${txt}"`);
      return;
    }
  }
  await btns.last().click({ force: true });
  await page.waitForTimeout(2_000);
  console.log('  crop confirmed (last button)');
}

/**
 * Find the block-add "+" button to the left of the element immediately
 * following the target heading, then click it to open the insert menu.
 * Returns click coordinates or null.
 */
async function findPlusButtonAfterHeading(page, headingText) {
  return await page.evaluate((hText) => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) return null;

    // Find target heading — both real <h> elements and raw markdown <p> blocks
    let heading = Array.from(editor.querySelectorAll('h1, h2, h3, h4')).find(h => h.textContent?.includes(hText));
    if (!heading) heading = Array.from(editor.querySelectorAll('p, div')).find(el => el.textContent?.trim().includes(hText));
    if (!heading) return null;

    // Get the element immediately after the heading
    const nextEl = heading.nextElementSibling ?? heading.parentElement?.nextElementSibling;
    if (!nextEl) return null;

    // Scroll the next element into view
    nextEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    const r = nextEl.getBoundingClientRect();

    // The "+" block-add button is at the left margin of each block.
    // From inspection: it sits ~50px to the left of the block text.
    // We click at x = r.left - 55 (just left of the block), y = center of block.
    const plusX = Math.max(r.left - 55, 10);
    const plusY = r.top + Math.min(r.height / 2, 16);

    return {
      plusX, plusY,
      blockLeft: Math.round(r.left),
      blockTop: Math.round(r.top),
      nextText: nextEl.textContent?.trim().slice(0, 40),
    };
  }, headingText);
}

async function insertImageAfterHeading(page, headingText, absImagePath) {
  console.log(`  target heading: "${headingText.slice(0, 50)}"`);

  // Step 1: use Selection API to place cursor at end of heading (bypasses click/focus issues)
  const placed = await page.evaluate((hText) => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) return null;

    // Case 1: proper <h> elements
    let heading = Array.from(editor.querySelectorAll('h1, h2, h3, h4'))
      .find(h => h.textContent?.includes(hText));

    // Case 2: raw markdown text (## heading) stored as <p> — body posted as plain text
    if (!heading) {
      heading = Array.from(editor.querySelectorAll('p, div'))
        .find(el => {
          const t = el.textContent?.trim() ?? '';
          return t.includes(hText) && (t.startsWith('#') || t.includes(hText));
        });
    }

    if (!heading) return null;

    // Place cursor at very end of heading content
    const range = document.createRange();
    range.selectNodeContents(heading);
    range.collapse(false); // end of heading
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    editor.focus();

    // Scroll heading into center of viewport
    heading.scrollIntoView({ behavior: 'instant', block: 'center' });
    const r = heading.getBoundingClientRect();
    return { x: r.left, y: r.top, h: r.height };
  }, headingText);

  if (!placed) {
    console.log('  ⚠ heading not found in ProseMirror');
    return false;
  }
  console.log(`  cursor placed at heading y=${placed.y.toFixed(0)}`);

  await page.waitForTimeout(400);

  // Step 2: press Enter to create new empty paragraph (ProseMirror should handle this)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);

  // Scroll the newly created empty paragraph into view
  await page.evaluate((hText) => {
    const editor = document.querySelector('.ProseMirror');
    let heading = Array.from(editor.querySelectorAll('h1,h2,h3,h4')).find(h => h.textContent?.includes(hText));
    if (!heading) heading = Array.from(editor.querySelectorAll('p,div')).find(el => el.textContent?.trim().includes(hText));
    if (heading?.nextElementSibling) {
      heading.nextElementSibling.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  }, headingText);

  // Step 2: hover the left margin of the new empty paragraph to reveal "+"
  // The "+" button appears when hovering near the left edge of each block.
  // After Enter, the cursor is on the new empty paragraph.
  // We hover at the left margin column (x ~ editor_left - 45).
  const editorLeft = await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) return 400;
    return editor.getBoundingClientRect().left;
  });

  // Get current cursor paragraph position
  const cursorInfo = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    let el = range.startContainer;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    while (el && !['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE'].includes(el.tagName)) el = el.parentElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, h: r.height, text: el.textContent?.trim().slice(0, 30) };
  });

  console.log(`  cursor paragraph: ${JSON.stringify(cursorInfo)}, editorLeft: ${editorLeft}`);

  const hoverY = cursorInfo ? cursorInfo.y + cursorInfo.h / 2 : 400;
  const plusHoverX = Math.max(editorLeft - 45, 10);

  // Hover near the left margin to reveal the "+" button
  await page.mouse.move(plusHoverX, hoverY);
  await page.waitForTimeout(600);

  // Step 3: try clipboard paste (most reliable for image insertion in ProseMirror)
  let imageInserted = false;
  const imgsBefore = await page.evaluate(() => document.querySelectorAll('.ProseMirror img').length);

  try {
    const imageData = fs.readFileSync(absImagePath).toString('base64');
    const mimeType = absImagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    await page.evaluate(async ({ data, mime }) => {
      const blob = await fetch(`data:${mime};base64,${data}`).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
    }, { data: imageData, mime: mimeType });
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(3_000);
    const imgsAfter = await page.evaluate(() => document.querySelectorAll('.ProseMirror img').length);
    console.log(`  imgs before: ${imgsBefore}, after: ${imgsAfter}`);
    if (imgsAfter > imgsBefore) {
      console.log('  image inserted via clipboard paste');
      imageInserted = true;
    }
  } catch (err) {
    console.log('  clipboard paste failed:', err.message.slice(0, 60));
  }

  // Step 4: fallback — hover-revealed "+" button → block menu → image upload
  if (!imageInserted) {
    console.log('  trying hover-revealed + button...');

    // Re-hover to trigger "+" button
    await page.mouse.move(plusHoverX, hoverY);
    await page.waitForTimeout(400);

    // Find the small block-add button that appeared in the left margin
    const plusCoords = await page.evaluate((approxY) => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
      const leftBtns = candidates.filter(b => {
        const r = b.getBoundingClientRect();
        return r.x < 350 && r.x > 0 && r.width > 10 && r.width < 60 && r.height > 10 && r.height < 60;
      });
      // Pick the one closest to the cursor paragraph y
      leftBtns.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return Math.abs(ar.top - approxY) - Math.abs(br.top - approxY);
      });
      const target = leftBtns[0];
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, cls: target.className.toString().slice(0, 40) };
    }, hoverY);

    console.log('  "+" button found:', plusCoords);

    if (plusCoords) {
      // Click "+" and handle block insert menu
      await page.mouse.click(plusCoords.x, plusCoords.y);
      await page.waitForTimeout(700);

      const menuImgSelectors = [
        'button:has-text("画像をアップロード")',
        '[role="menuitem"]:has-text("画像をアップロード")',
        'button:has-text("画像")',
        '[role="menuitem"]:has-text("画像")',
      ];
      for (const sel of menuImgSelectors) {
        const item = page.locator(sel).first();
        if (await item.count() > 0) {
          try {
            const [fc] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 5_000 }),
              item.click(),
            ]);
            await fc.setFiles(absImagePath);
            await page.waitForTimeout(3_000);
            imageInserted = true;
            console.log(`  inserted via menu: ${sel}`);
            break;
          } catch {
            // Nested submenu
            await page.waitForTimeout(400);
            const sub = page.locator('button:has-text("画像をアップロード"), button:has-text("ローカル")').first();
            if (await sub.count() > 0) {
              try {
                const [fc2] = await Promise.all([
                  page.waitForEvent('filechooser', { timeout: 5_000 }),
                  sub.click(),
                ]);
                await fc2.setFiles(absImagePath);
                await page.waitForTimeout(3_000);
                imageInserted = true;
                console.log('  inserted via nested submenu');
              } catch { /* skip */ }
            }
          }
          if (imageInserted) break;
        }
      }
      if (!imageInserted) await page.keyboard.press('Escape');
    }
  }

  if (imageInserted) await handleCropModal(page);
  return imageInserted;
}

async function processArticle(accountId, noteKey, heading, imagePath) {
  const absImage = path.resolve(imagePath);
  if (!fs.existsSync(absImage)) { console.error('Image not found:', absImage); return false; }

  const account = ACCOUNTS[accountId];
  const sessionFile = path.join(__dirname, '..', account.session);
  if (!fs.existsSync(sessionFile)) { console.error('Session not found:', sessionFile); return false; }

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    storageState: sessionFile,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();

  const url = `https://editor.note.com/notes/${noteKey}/edit/`;
  console.log(`\nOpening: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(2_000);

  // Auto-save before modifying
  const saveBtn = page.locator('button:has-text("一時保存")').first();
  if (await saveBtn.count() > 0) {
    await saveBtn.click();
    await page.waitForTimeout(2_000);
    console.log('  auto-saved');
  }

  await shot(page, `before-${noteKey}`);

  const ok = await insertImageAfterHeading(page, heading, absImage);

  if (ok) {
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await page.waitForTimeout(2_000);
    }
    await shot(page, `after-${noteKey}`);
    console.log(`  ✓ image inserted: ${path.basename(imagePath)}`);
  } else {
    const p = await shot(page, `fail-${noteKey}`);
    console.log(`  ⚠ insertion failed — screenshot: ${p}`);
  }

  await browser.close();
  return ok;
}

async function main() {
  const { accountId, noteKey, heading, imagePath, all } = parseArgs();

  if (all) {
    const manifestPath = path.join(__dirname, '..', '.tmp-note-images', 'article', 'manifest.json');
    if (!fs.existsSync(manifestPath)) { console.error('Run gen-article-images.js first.'); process.exit(1); }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    let success = 0, failed = 0;
    for (const entry of manifest) {
      console.log(`\n=== ${entry.noteKey} — ${entry.name} ===`);
      const ok = await processArticle(entry.account, entry.noteKey, entry.heading, entry.path);
      if (ok) success++; else failed++;
      await new Promise(r => setTimeout(r, 2_000));
    }
    console.log(`\n=== Done: ${success} inserted, ${failed} failed ===`);
  } else {
    if (!noteKey || !heading || !imagePath) {
      console.error('Usage: node note/insert-image-after-heading.js --account 1 --noteKey <key> --heading "<text>" --image <path>');
      console.error('       node note/insert-image-after-heading.js --all');
      process.exit(1);
    }
    await processArticle(accountId, noteKey, heading, imagePath);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
