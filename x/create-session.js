/**
 * X セッション作成 — CDP 接続方式
 *
 * launchPersistentContext は --use-mock-keychain を注入するため Brave/Chrome がクラッシュする。
 * connectOverCDP はフラグを注入しないため Keychain にアクセスでき、既存ログインをそのまま利用できる。
 *
 * 使い方:
 *   node x/create-session.js            # Brave（デフォルト）
 *   BROWSER=chrome node x/create-session.js
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../.x-session.json');
const CDP_URL      = 'http://localhost:9222';

const BROWSERS = {
  brave:  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
};
const BROWSER_PATH = BROWSERS[process.env.BROWSER ?? 'brave'] ?? BROWSERS.brave;

const rl  = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function isCdpReady() {
  try { return (await fetch(`${CDP_URL}/json/version`)).ok; } catch { return false; }
}

// ── CDP が既に利用可能か確認 ───────────────────────────────────────
let ready = await isCdpReady();

if (!ready) {
  console.log('');
  console.log('Brave/Chrome をデバッグポート付きで起動します。');
  console.log('既にブラウザが起動中の場合は Cmd+Q で終了してください。');
  await ask('終了後 Enter を押してください: ');

  console.log('\n起動中...');
  spawn(BROWSER_PATH, ['--remote-debugging-port=9222'], {
    detached: true, stdio: 'ignore',
  }).unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isCdpReady()) { ready = true; break; }
  }

  if (!ready) {
    console.error('✗ ブラウザ起動タイムアウト');
    process.exit(1);
  }
}

// ── CDP 接続 ────────────────────────────────────────────────────────
console.log('\n✓ ブラウザに接続中...');
let browser;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 60000 });
    break;
  } catch (e) {
    if (attempt === 3) throw e;
    console.log(`  接続リトライ ${attempt}/3... Brave の起動を待ってください`);
    await new Promise(r => setTimeout(r, 3000));
  }
}

const context = browser.contexts()[0] ?? await browser.newContext();
const page    = context.pages()[0]    ?? await context.newPage();

await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });

const url       = page.url();
const loggedIn  = !url.includes('/login') && !url.includes('/i/flow');
console.log(loggedIn
  ? '✓ X にログイン済みを確認'
  : '⚠ ログインページです。手動でログインしてください。');

await ask('\nEnter を押してセッションを保存: ');
rl.close();

await context.storageState({ path: SESSION_FILE });
console.log(`\n✓ セッション保存完了: ${SESSION_FILE}`);

await browser.close();
