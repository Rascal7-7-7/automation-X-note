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
  await page.waitForTimeout(3_000);

  // Step1: メールアドレス入力（typeメソッドでキー入力してReactのバリデーションを確実にトリガー）
  const usernameInput = page.locator('input[autocomplete="username"]');
  await usernameInput.click({ force: true });
  await page.waitForTimeout(500);
  await usernameInput.pressSequentially(process.env.X_EMAIL, { delay: 50 });
  await page.waitForTimeout(1_000);

  // 「次へ」ボタン: data-testid 優先 → role fallback
  const nextBtn = page.locator('[data-testid="LoginForm_Next_Button"]');
  if (await nextBtn.count() > 0) {
    await nextBtn.click();
  } else {
    await page.getByRole('button', { name: /Next|次へ/ }).first().click();
  }

  // パスワード画面 OR 追加確認画面が現れるまで待つ（最大10秒）
  await page.waitForTimeout(1_000);
  await Promise.race([
    page.waitForSelector('input[type="password"]', { timeout: 10_000 }),
    page.waitForSelector('input[data-testid="ocfEnterTextTextInput"]', { timeout: 10_000 }),
  ]).catch(() => {});

  logger.info(MODULE, `step2 url: ${page.url()}`);

  // Step2: ユーザー名確認 or 電話番号確認が出た場合
  const extraInput = page.locator('input[data-testid="ocfEnterTextTextInput"]');
  if (await extraInput.count() > 0) {
    logger.info(MODULE, 'additional verification required — entering username/email');
    // ユーザー名確認の場合はXのユーザー名（@なし）を入力、電話番号確認の場合は電話番号
    const verifyValue = process.env.X_USERNAME ?? process.env.X_EMAIL;
    await extraInput.fill(verifyValue);
    await page.waitForTimeout(500);
    await page.locator('[data-testid="ocfEnterTextNextButton"]').click();
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    await page.waitForTimeout(1_000);
  }

  // Step3: パスワード
  logger.info(MODULE, `step3 url: ${page.url()}`);
  const pwInput = page.locator('input[type="password"]');
  await pwInput.waitFor({ state: 'visible', timeout: 15_000 });
  await pwInput.fill(process.env.X_PASSWORD);
  await page.waitForTimeout(500);

  const loginBtn = page.locator('[data-testid="LoginForm_Login_Button"]');
  if (await loginBtn.count() > 0) {
    await loginBtn.click();
  } else {
    await page.getByRole('button', { name: /Log in|ログイン/ }).first().click();
  }
  await page.waitForTimeout(5_000);

  const success = await page.locator('[data-testid="SideNav_NewTweet_Button"]').count() > 0;
  if (!success) {
    throw new Error('X login failed — check X_EMAIL / X_PASSWORD / X_USERNAME');
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
    try {
      await login(page);
      await context.storageState({ path: SESSION_FILE });
      logger.info(MODULE, `session saved: ${SESSION_FILE}`);
    } catch (err) {
      // セッションが壊れている場合は削除して新規ログイン
      if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
        logger.warn(MODULE, 'stale session deleted — retrying fresh login');
        await page.close();
        const freshContext = await browser.newContext({
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
          locale: 'ja-JP',
        });
        const freshPage = await freshContext.newPage();
        await login(freshPage);
        await freshContext.storageState({ path: SESSION_FILE });
        logger.info(MODULE, 'fresh session saved');
        return { browser, context: freshContext, page: freshPage };
      }
      throw err;
    }
  }

  return { browser, context, page };
}
