/**
 * X ブラウザクライアント（Playwright セッション管理）
 * - APIの代替としてブラウザで X を操作する
 * - セッションを .x-session.json に永続化（ログイン回数を最小化）
 * - research / post / like が全てこのモジュールを共有する
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../.x-session.json');
const MODULE = 'x:browser';

/** ログイン済みかどうか確認 */
async function isLoggedIn(page) {
  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(2_000);
    // ホームのコンポーズボタンが見えればログイン済み
    const count = await page.locator('[data-testid="SideNav_NewTweet_Button"]').count();
    return count > 0;
  } catch {
    return false;
  }
}

/** X にログイン */
async function login(page) {
  logger.info(MODULE, 'logging in to x.com');

  await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 15_000 });
  await page.waitForTimeout(2_000);

  // Step1: ユーザー名 or メールアドレス
  const usernameInput = page.locator('input[autocomplete="username"]');
  await usernameInput.click();
  // React管理のinputにはnativeInputValueSetterでイベントを発火させる必要がある
  await page.evaluate((email) => {
    const input = document.querySelector('input[autocomplete="username"]');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(input, email);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, process.env.X_EMAIL);
  await page.waitForTimeout(1_000);
  await page.locator('[data-testid="LoginForm_Next_Button"]').or(page.getByText('次へ')).or(page.getByText('Next')).first().click();
  await page.waitForTimeout(2_000);

  logger.info(MODULE, `step2 url: ${page.url()}`);

  // Step2: メールアドレス確認を求められる場合（電話番号も同様）
  const extraInput = page.locator('input[data-testid="ocfEnterTextTextInput"]');
  if (await extraInput.count() > 0) {
    logger.info(MODULE, 'additional verification required');
    await extraInput.fill(process.env.X_EMAIL);
    await page.locator('[data-testid="ocfEnterTextNextButton"]').click();
    await page.waitForTimeout(2_000);
  }

  // Step3: パスワード
  logger.info(MODULE, `step3 url: ${page.url()}`);
  await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
  await page.locator('input[type="password"]').fill(process.env.X_PASSWORD);
  await page.locator('[data-testid="LoginForm_Login_Button"]').or(page.getByText('ログイン')).or(page.getByText('Log in')).first().click();
  await page.waitForTimeout(4_000);

  const success = await page.locator('[data-testid="SideNav_NewTweet_Button"]').count() > 0;
  if (!success) {
    throw new Error('X login failed — check X_EMAIL and X_PASSWORD');
  }

  logger.info(MODULE, 'login success');
}

/**
 * セッション付きブラウザコンテキストを取得する
 * 未ログインなら自動でログインしてセッションを保存する
 * @returns {{ browser, context, page }} — 使い終わったら browser.close() すること
 */
export async function getXBrowser(opts = {}) {
  const headless = opts.headless ?? true;

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState: fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
    locale: 'ja-JP',
  });
  const page = await context.newPage();

  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    await login(page);
    await context.storageState({ path: SESSION_FILE });
    logger.info(MODULE, `session saved: ${SESSION_FILE}`);
  }

  return { browser, context, page };
}
