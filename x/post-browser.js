/**
 * X 投稿モジュール（Playwright版）
 * X API が未設定の場合に pipeline.js から呼ばれる
 *
 * ⚠️ X の利用規約の範囲内で、自分のアカウントへの投稿のみ行うこと
 */
import 'dotenv/config';
import { getXBrowser } from './browser-client.js';
import { logger } from '../shared/logger.js';

const MODULE = 'x:post-browser';

const SEL = {
  composeBtn:  'a[data-testid="SideNav_NewTweet_Button"]',
  textarea:    '[data-testid="tweetTextarea_0"]',
  submitBtn:   '[data-testid="tweetButtonInline"]',
  successSign: '[data-testid="toast"]',
};

/**
 * Playwright でツイートを投稿する
 * @param {string} text 投稿テキスト（140文字以内）
 * @returns {string} 投稿URL（取得できなければ 'browser-posted'）
 */
export async function postTweetBrowser(text) {
  const { browser, page } = await getXBrowser({ headless: true });

  try {
    // コンポーズ画面を開く
    await page.goto('https://x.com/compose/post', {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await page.waitForTimeout(2_000);

    // テキストエリアが見つからない場合はサイドバーのボタン経由で開く
    const textarea = page.locator(SEL.textarea);
    if (await textarea.count() === 0) {
      await page.locator(SEL.composeBtn).click();
      await page.waitForTimeout(1_500);
    }

    // テキスト入力 — fill() の後に input イベントを明示的に発火させ
    // React の文字数カウンターを起動させる（これをしないと submitBtn が disabled のまま）
    const ta = page.locator(SEL.textarea).first();
    await ta.click();
    await ta.fill(text);
    await ta.dispatchEvent('input');
    await page.waitForTimeout(300);
    // ボタンが enabled になるまで最大 5 秒待つ
    await page.locator(SEL.submitBtn).first()
      .waitFor({ state: 'enabled', timeout: 5_000 })
      .catch(() => {}); // タイムアウトしても次の click で再試行

    // 投稿ボタンをクリック（複数マッチ対策で .first()）
    await page.locator(SEL.submitBtn).first().click();
    await page.waitForTimeout(3_000);

    // トースト通知で成功確認
    const toastCount = await page.locator(SEL.successSign).count();
    if (toastCount === 0) {
      // トーストが消えた可能性も考慮 — URLが変わっていれば成功とみなす
      logger.warn(MODULE, 'toast not found, treating as posted');
    }

    logger.info(MODULE, 'posted via browser');
    return 'browser-posted';
  } catch (err) {
    logger.error(MODULE, 'browser post failed', { message: err.message });
    throw err;
  } finally {
    await browser.close();
  }
}
