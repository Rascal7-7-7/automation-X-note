/**
 * X セッション手動作成スクリプト
 *
 * 使い方:
 *   node x/create-session.js
 *
 * ブラウザが開くので手動でログインしてください。
 * ログイン完了を確認後 Enter を押すとセッションが保存されます。
 * 保存後は x:like / x:reply が自動でセッションを再利用します（〜数ヶ月有効）。
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../.x-session.json');

// システムのChromeを使用（ボット検知回避）
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await chromium.launch({
  headless: false,
  executablePath: CHROME_PATH,
  args: [
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',  // navigator.webdriver を隠す
    '--disable-infobars',
    '--no-sandbox',
  ],
});
const context = await browser.newContext({
  viewport: null,
  locale: 'ja-JP',
});
const page = await context.newPage();

// Playwright が埋め込む自動化フラグを完全に除去
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  delete navigator.__proto__.webdriver;
});

await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });

console.log('');
console.log('========================================');
console.log('  ブラウザで X にログインしてください');
console.log('  ログイン完了後、ここで Enter を押してください');
console.log('========================================');
console.log('');

const rl = createInterface({ input: process.stdin, output: process.stdout });
await new Promise(resolve => rl.question('Enter を押してセッションを保存: ', resolve));
rl.close();

await context.storageState({ path: SESSION_FILE });
console.log(`✓ セッション保存完了: ${SESSION_FILE}`);
console.log('  次回から x:like / x:reply が自動でこのセッションを使用します');

await browser.close();
