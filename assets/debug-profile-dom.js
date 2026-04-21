/**
 * note.com プロフィールページのDOM要素を調査するデバッグスクリプト
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../.note-session-2.json');

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const context = await browser.newContext({ storageState: SESSION_FILE });
const page    = await context.newPage();

await page.goto('https://note.com/settings/profile', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// すべてのinput・textarea・button要素の属性を出力
const elements = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input, textarea')).map(el => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    value: el.value?.slice(0, 50),
    className: el.className?.slice(0, 80),
    accept: el.accept,
  }));

  const buttons = Array.from(document.querySelectorAll('button')).map(btn => ({
    text: btn.textContent?.trim()?.slice(0, 40),
    type: btn.type,
    'data-id': btn.dataset.id,
    className: btn.className?.slice(0, 80),
  }));

  return { inputs, buttons };
});

console.log('\n=== INPUTS & TEXTAREAS ===');
elements.inputs.forEach((el, i) => console.log(`[${i}]`, JSON.stringify(el)));

console.log('\n=== BUTTONS ===');
elements.buttons.forEach((el, i) => console.log(`[${i}]`, JSON.stringify(el)));

await page.screenshot({ path: path.join(__dirname, 'note-accounts/debug-dom-scan.png') });
await browser.close();
