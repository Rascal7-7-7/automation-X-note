/**
 * YouTube Studio ブラウザセッション保存
 *
 * 使い方（初回のみ実行）:
 *   node youtube/save-session.js
 *
 * 処理:
 *   1. インストール済み Chrome で起動（Google の Bot 検出を回避）
 *   2. YouTube Studio を開く → ユーザーが手動でログイン
 *   3. ログイン検出後にセッション状態を保存
 *   4. .youtube-session.json に書き出して終了
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE  = path.join(__dirname, '..', '.youtube-session.json');
const STUDIO_URL    = 'https://studio.youtube.com';

async function main() {
  console.log('Chrome 起動中...');
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',            // インストール済み Chrome を使用（Bot検出回避）
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // navigator.webdriver を隠す
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.goto(STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log('YouTube Studio を開きました。Googleアカウントでログインしてください。');
  console.log('ログイン完了後、Studio のダッシュボードが表示されるまでお待ちください...');

  // YouTube Studio ダッシュボード到達を検出
  await page.waitForURL(/studio\.youtube\.com\/channel\//, { timeout: 120_000 });
  console.log('ログイン確認。セッション保存中...');
  await page.waitForTimeout(2000);

  await context.storageState({ path: SESSION_FILE });
  console.log(`✅ セッション保存完了: ${SESSION_FILE}`);

  await browser.close();
}

main().catch(err => {
  console.error('セッション保存失敗:', err.message);
  process.exit(1);
});
