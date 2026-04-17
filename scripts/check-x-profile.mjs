/**
 * X プロフィール確認スクリプト（ログイン不要・公開ページ）
 */
import 'dotenv/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());

const USERNAME = 'Rascal_AI_Dev';

async function checkXProfile() {
  console.log(`\n=== X @${USERNAME} プロフィール確認 ===`);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'ja-JP',
    });
    const page = await context.newPage();

    await page.goto(`https://x.com/${USERNAME}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log('URL:', page.url());
    console.log('Title:', await page.title());

    // ツイート取得
    const tweets = await page.locator('article[data-testid="tweet"]').all();
    console.log(`\nツイート数（表示中）: ${tweets.length}`);

    const results = [];
    for (const tweet of tweets.slice(0, 5)) {
      try {
        const text = await tweet.locator('[data-testid="tweetText"]').textContent().catch(() => '');
        const time = await tweet.locator('time').getAttribute('datetime').catch(() => null);
        const url = await tweet.locator('time').locator('..').getAttribute('href').catch(() => null);
        results.push({ text: text.trim(), time, url });
        console.log(`\n[${time}]`);
        console.log(text.trim().substring(0, 120));
      } catch {}
    }

    if (results.length === 0) {
      // 認証壁の可能性
      const bodyText = await page.locator('body').textContent().catch(() => '');
      console.log('ページ内容（先頭300文字）:', bodyText.substring(0, 300));
    }

    return results;
  } catch (err) {
    console.error('エラー:', err.message);
    return [];
  } finally {
    await browser?.close();
  }
}

checkXProfile().then(posts => {
  console.log('\n=== 結果 ===');
  if (posts.length > 0) {
    console.log(`最終投稿日: ${posts[0]?.time}`);
    console.log(`投稿確認数: ${posts.length}件`);
  } else {
    console.log('投稿取得失敗（認証壁またはページ構造変化の可能性）');
  }
});
