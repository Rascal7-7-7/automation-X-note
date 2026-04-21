/**
 * note.com 相互フォロースクリプト
 * account1・2・3 が互いをフォローする
 *
 * 使い方: node note/mutual-follow.js
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ACCOUNTS = {
  1: { sessionFile: '.note-session.json',   profileUrl: 'https://note.com/rascal_ai_devops' },
  2: { sessionFile: '.note-session-2.json', profileUrl: 'https://note.com/rascal_invest'    },
  3: { sessionFile: '.note-session-3.json', profileUrl: 'https://note.com/rascal_affiliate' },
};

// accountId でログインし、targetUrls をフォローする
async function followTargets(accountId, targetUrls) {
  const { sessionFile } = ACCOUNTS[accountId];
  const sessionPath = path.join(__dirname, '..', sessionFile);

  console.log(`\n── アカウント${accountId} でフォロー開始 ──`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: sessionPath });
  const page    = await context.newPage();

  for (const targetUrl of targetUrls) {
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      // フォローボタンを探す（既にフォロー済みなら skip）
      const followBtn = page.locator('button:has-text("フォロー"):not(:has-text("フォロー中"))').first();
      const alreadyFollowing = page.locator('button:has-text("フォロー中")').first();

      if (await alreadyFollowing.count() > 0) {
        console.log(`  ✓ ${targetUrl} — 既にフォロー済み`);
      } else if (await followBtn.count() > 0) {
        await followBtn.click();
        await page.waitForTimeout(2000);
        console.log(`  ✓ ${targetUrl} — フォローしました`);
      } else {
        // 自分のアカウントページ or ボタンが見つからない
        console.log(`  - ${targetUrl} — フォローボタンなし（自分のアカウントか未ログイン）`);
      }
    } catch (err) {
      console.warn(`  ✗ ${targetUrl} — エラー: ${err.message}`);
    }
  }

  await browser.close();
}

// 全アカウントが互いをフォロー
const pairs = [
  { from: 1, targets: [ACCOUNTS[2].profileUrl, ACCOUNTS[3].profileUrl] },
  { from: 2, targets: [ACCOUNTS[1].profileUrl, ACCOUNTS[3].profileUrl] },
  { from: 3, targets: [ACCOUNTS[1].profileUrl, ACCOUNTS[2].profileUrl] },
];

for (const { from, targets } of pairs) {
  await followTargets(from, targets);
}

console.log('\n=== 相互フォロー完了 ===');
