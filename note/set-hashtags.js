/**
 * Set hashtags on a published note.com article
 * Usage: node note/set-hashtags.js <noteUrl> <accountId> <tag1> <tag2> ...
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [,, noteUrl, accountId = '1', ...tags] = process.argv;

if (!noteUrl || tags.length === 0) {
  console.error('Usage: node note/set-hashtags.js <noteUrl> <accountId> <tag1> <tag2> ...');
  process.exit(1);
}

const sessions = { '1': '.note-session.json', '2': '.note-session-2.json', '3': '.note-session-3.json' };
const sessionFile = path.join(__dirname, '..', sessions[accountId]);

function noteIdFromUrl(url) {
  const m = url.match(/\/n\/(n[a-z0-9]+)/);
  return m?.[1] ?? null;
}

const noteId = noteIdFromUrl(noteUrl);
if (!noteId) { console.error('invalid noteUrl'); process.exit(1); }

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
  viewport: { width: 1280, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
});
const page = await context.newPage();

await page.goto(`https://note.com/notes/${noteId}/edit`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
await page.waitForTimeout(3_000);
console.log('edit url:', page.url());

// Open publish panel
const selectors = ['button:has-text("公開に進む")', 'button:has-text("公開する")', 'button:has-text("公開")'];
let opened = false;
for (const sel of selectors) {
  const btn = page.locator(sel).first();
  if (await btn.count() > 0) { await btn.click(); await page.waitForTimeout(2_500); opened = true; break; }
}
if (!opened) { console.error('could not open publish panel'); await browser.close(); process.exit(1); }

// Click ハッシュタグ accordion
const hashBtn = page.locator('button:has-text("ハッシュタグ"), span:has-text("ハッシュタグ")').first();
if (await hashBtn.count() > 0) {
  await hashBtn.click();
  await page.waitForTimeout(1_200);
}

// Find tag input — note.com uses a text input inside the hashtag section
const tagInputSelectors = [
  'input[placeholder*="タグ"]',
  'input[placeholder*="ハッシュタグ"]',
  'input[placeholder*="追加"]',
  '[class*="hashtag"] input',
  '[class*="tag"] input[type="text"]',
  '[class*="Hash"] input',
  '[class*="Tag"] input',
];

let tagInput = null;
for (const sel of tagInputSelectors) {
  const el = page.locator(sel).first();
  if (await el.count() > 0) { tagInput = el; console.log('tag input found:', sel); break; }
}

// Fallback: click inside the hashtag section area to reveal input
if (!tagInput) {
  const hashSection = page.locator('[class*="hashtag"], [class*="Hashtag"], [class*="Hash"]').first();
  if (await hashSection.count() > 0) {
    await hashSection.click();
    await page.waitForTimeout(600);
    // Re-check
    for (const sel of tagInputSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) { tagInput = el; console.log('tag input found after section click:', sel); break; }
    }
  }
}

// Dump all inputs for diagnosis if still not found
if (!tagInput) {
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type, placeholder: i.placeholder, className: i.className?.slice(0,60),
    }))
  );
  console.log('all inputs:', JSON.stringify(inputs));
} else {
  for (const tag of tags) {
    await tagInput.click();
    await tagInput.fill(tag);
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    console.log('tag added:', tag);
  }
}

// Confirm — try direct 更新する first, fall back to paid flow
await page.waitForTimeout(1_000);
await page.evaluate(() => {
  const divs = Array.from(document.querySelectorAll('div')).filter(el => el.scrollHeight > el.clientHeight + 10);
  divs.sort((a, b) => b.scrollHeight - a.scrollHeight);
  if (divs[0]) divs[0].scrollTo(0, divs[0].scrollHeight);
  else window.scrollTo(0, document.body.scrollHeight);
});
await page.waitForTimeout(500);

// Check if paid article (有料エリア設定 button present)
const paidBtn = page.locator('button:has-text("有料エリア設定")').first();
if (await paidBtn.count() > 0) {
  await paidBtn.click();
  console.log('paid flow: 有料エリア設定 clicked');
  await page.waitForTimeout(2_500);

  // In boundary modal, click 更新する directly (no boundary change needed for hashtag-only update)
  const updateBtn = page.locator('button:has-text("更新する")').first();
  if (await updateBtn.count() > 0) {
    await updateBtn.click();
    console.log('boundary modal: 更新する clicked');
    try { await page.waitForURL(/note\.com.*\/n\//, { timeout: 15_000 }); } catch { /* ok */ }
  } else {
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
    );
    console.log('boundary modal buttons:', btns.join(' | '));
  }
} else {
  const directBtn = page.locator('button:has-text("更新する"), button:has-text("投稿する"), button:has-text("公開する")').first();
  if (await directBtn.count() > 0) {
    const txt = await directBtn.textContent();
    await directBtn.click();
    console.log('confirmed:', txt?.trim());
    await page.waitForTimeout(3_000);
  } else {
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
    );
    console.log('confirm button not found. visible:', btns.join(' | '));
  }
}

console.log('done. url:', page.url());
await browser.close();
