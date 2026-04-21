/**
 * note.com 記事内プレースホルダー削除 + 実画像挿入
 *
 * 使い方:
 *   node note/update-article-images.js --account 2 --noteKey nd563d3f39dc1
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

const IMAGE_DIR = path.join(__dirname, '..', '.tmp-note-images');

// Map placeholder names to generated image files
const PLACEHOLDER_MAP = {
  'n8n-workflow-canvas.png':      path.join(IMAGE_DIR, 'n8n-workflow-canvas.png'),
  'sheets-auto-categorized.png':  path.join(IMAGE_DIR, 'sheets-auto-categorized.png'),
};

function parseArgs() {
  const args = process.argv.slice(2);
  let accountId = 2;
  let noteKey = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--account' && args[i + 1]) accountId = Number(args[++i]);
    if (args[i] === '--noteKey' && args[i + 1]) noteKey = args[++i];
  }
  return { accountId, noteKey };
}

async function screenshot(page, name) {
  const p = path.join(__dirname, '..', 'assets', 'note-accounts', `update-img-${name}.png`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  await page.screenshot({ path: p });
  console.log('  screenshot:', p);
}

// Find ProseMirror paragraph containing placeholder text, click it, replace with image
async function replacePlaceholderWithImage(page, placeholderText, imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    console.log(`  no image file for: ${placeholderText}`);
    return false;
  }

  console.log(`  replacing: ${placeholderText}`);

  // Find the element containing the placeholder text in ProseMirror
  // Find element AND get rect in single evaluate to avoid ProseMirror re-render losing attributes
  const rect = await page.evaluate((placeholder) => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) return null;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes(placeholder)) {
        let el = node.parentElement;
        while (el && !['P', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'LI'].includes(el.tagName)) {
          el = el.parentElement;
        }
        if (el) {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          const r = el.getBoundingClientRect();
          return { x: r.left + 4, y: r.top + r.height / 2, found: true };
        }
      }
    }
    return null;
  }, placeholderText);

  if (!rect) {
    console.log(`  placeholder not found in editor: ${placeholderText}`);
    return false;
  }

  await page.waitForTimeout(400);

  if (!rect) {
    console.log('  could not get element rect');
    return false;
  }

  // Use precise Range to select ONLY the block element containing placeholder
  // (avoids Home+Shift+End selecting too much in ProseMirror)
  const deleted = await page.evaluate((placeholder) => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) return false;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes(placeholder)) {
        // Find the block parent
        let block = node.parentElement;
        while (block && !['P', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'LI', 'DIV'].includes(block.tagName)) {
          block = block.parentElement;
        }
        if (block && block !== editor) {
          const range = document.createRange();
          range.selectNodeContents(block);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          // Use execCommand to delete the selection
          document.execCommand('delete');
          return true;
        }
      }
    }
    return false;
  }, placeholderText);

  if (!deleted) {
    console.log('  execCommand delete failed — trying keyboard approach');
    await page.mouse.click(rect.x, rect.y);
    await page.waitForTimeout(200);
    // Triple-click selects just the paragraph in most editors
    await page.mouse.click(rect.x, rect.y, { clickCount: 3 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Delete');
  } else {
    console.log('  placeholder deleted via execCommand');
  }
  await page.waitForTimeout(300);

  // Remove the data attribute
  await page.evaluate(() => {
    document.querySelector('[data-placeholder-target]')?.removeAttribute('data-placeholder-target');
  });

  // Insert image: note.com now uses a submenu (click button → submenu → "ローカル" → filechooser)
  let imageInserted = false;

  // Step 1: click the "+" or image block-insert button to open submenu
  const imgBtnSelectors = [
    'button[aria-label="画像を追加"]',
    'button[aria-label*="画像"]',
    'button[aria-label*="image"]',
    '[data-testid*="image"]',
  ];

  for (const sel of imgBtnSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() === 0) continue;

    // Try direct filechooser first (old behavior)
    try {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3_000 }),
        btn.click(),
      ]);
      await fc.setFiles(imagePath);
      await page.waitForTimeout(3_000);
      console.log(`  image inserted directly via: ${sel}`);
      imageInserted = true;
      break;
    } catch {
      // Submenu appeared instead — find and click the local file option
      await page.waitForTimeout(500);
      const submenuSelectors = [
        'button:has-text("ローカル")',
        'button:has-text("ファイルを選択")',
        'button:has-text("コンピュータ")',
        '[role="menuitem"]:has-text("ローカル")',
        '[role="menuitem"]:has-text("画像")',
      ];
      for (const ss of submenuSelectors) {
        const item = page.locator(ss).first();
        if (await item.count() > 0) {
          try {
            const [fc] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 4_000 }),
              item.click(),
            ]);
            await fc.setFiles(imagePath);
            await page.waitForTimeout(3_000);
            console.log(`  image inserted via submenu: ${ss}`);
            imageInserted = true;
            break;
          } catch (err2) {
            console.log(`  submenu filechooser failed for ${ss}: ${err2.message}`);
          }
        }
      }
      if (imageInserted) break;
      // Dismiss submenu if still open
      await page.keyboard.press('Escape');
    }
  }

  // Step 2: clipboard paste fallback — read image as data URL and paste
  if (!imageInserted) {
    try {
      const imageData = fs.readFileSync(imagePath).toString('base64');
      const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      await page.evaluate(async ({ data, mime }) => {
        const blob = await fetch(`data:${mime};base64,${data}`).then(r => r.blob());
        await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
      }, { data: imageData, mime: mimeType });
      await page.keyboard.press('Meta+v');
      await page.waitForTimeout(3_000);
      const hasImage = await page.evaluate(() => !!document.querySelector('.ProseMirror img'));
      if (hasImage) {
        console.log('  image inserted via clipboard paste');
        imageInserted = true;
      }
    } catch (err) {
      console.log(`  clipboard paste failed: ${err.message}`);
    }
  }

  if (!imageInserted) {
    console.log('  ⚠ image insert failed — add manually in editor');
    await page.screenshot({ path: path.join(__dirname, '..', 'assets', 'note-accounts', `img-fail-${Date.now()}.png`) });
  }

  return true;
}

async function main() {
  const { accountId, noteKey } = parseArgs();
  const account = ACCOUNTS[accountId];
  const sessionFile = path.join(__dirname, '..', account.session);

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ storageState: sessionFile, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();

  const editorUrl = `https://editor.note.com/notes/${noteKey}/edit/`;
  console.log(`Opening: ${editorUrl}`);
  await page.goto(editorUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await screenshot(page, 'before');

  // Find all placeholder references in live page
  const placeholders = await page.evaluate(() => {
    const text = document.body.innerText;
    const refs = text.match(/\[screenshot:[^\]]+\]/g) ?? [];
    return refs;
  });
  console.log('placeholders found:', placeholders);

  for (const placeholder of placeholders) {
    const imgName = placeholder.replace('[screenshot: ', '').replace('[screenshot:', '').replace(']', '').trim();
    const imgPath = PLACEHOLDER_MAP[imgName] ?? path.join(IMAGE_DIR, imgName);
    await replacePlaceholderWithImage(page, placeholder, imgPath);
    await page.waitForTimeout(1_000);
  }

  await screenshot(page, 'after');

  if (placeholders.length > 0) {
    // Save the article
    const saveBtns = ['button:has-text("一時保存")', 'button[aria-label*="保存"]'];
    for (const sel of saveBtns) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(2_000);
        console.log('article saved');
        break;
      }
    }
  }

  await browser.close();
  console.log('done');
}

main().catch(err => { console.error(err.message); process.exit(1); });
