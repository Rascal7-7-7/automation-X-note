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
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
import path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../.x-session.json');

const browser = await chromium.launch({
  headless: false,
  args: ['--start-maximized'],
});
const context = await browser.newContext({
  viewport: null,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'ja-JP',
});
const page = await context.newPage();

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
