/**
 * note 投稿 — 公開・いいね処理
 * publishNote, republishNote, selfLikeNote, crossLikeNote and helpers.
 */
import 'dotenv/config';
import { launchBrowser } from '../shared/browser-launch.js';
import fs from 'fs';
import { logger } from '../shared/logger.js';
import { takeDebugScreenshot, tryClick } from './post-browser.js';

const MODULE = 'note:post';

// ── 公開処理 ────────────────────────────────────────────────────────
// note ID を URL から抽出
export function extractNoteId(url) {
  const m = url.match(/\/n\/([a-z0-9]+)/);
  return m ? m[1] : null;
}

const LIKE_SELECTORS = [
  'button[data-test-id="likeButton"]',
  'button[aria-label*="スキ"]',
  'button[class*="likeButton"]',
  'button[class*="like-button"]',
  '[data-test="like-button"]',
];

async function clickLikeButton(page, noteId) {
  for (const sel of LIKE_SELECTORS) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      const pressed = await btn.getAttribute('aria-pressed').catch(() => null);
      if (pressed === 'true') {
        logger.info(MODULE, `like: already liked (${noteId})`);
        return true;
      }
      await btn.click();
      await page.waitForTimeout(1_000);
      logger.info(MODULE, `like: liked ${noteId} via ${sel}`);
      return true;
    }
  }
  logger.warn(MODULE, `like: button not found for ${noteId}`);
  return false;
}

export async function selfLikeNote(page, noteUrl, username) {
  try {
    const noteId = extractNoteId(noteUrl);
    if (!noteId) { logger.warn(MODULE, `selfLike: cannot extract noteId from ${noteUrl}`); return; }
    const publicUrl = `https://note.com/${username}/n/${noteId}`;
    await page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(2_000);
    await clickLikeButton(page, noteId);
  } catch (err) {
    logger.warn(MODULE, `selfLike failed: ${err.message}`);
  }
}

// 他アカウントのセッションから記事にいいね
export async function crossLikeNote(noteUrl, authorUsername, currentAccountId, getAccountPaths) {
  const noteId = extractNoteId(noteUrl);
  if (!noteId) return;
  const publicUrl = `https://note.com/${authorUsername}/n/${noteId}`;

  const otherAccountIds = [1, 2, 3].filter(id => id !== currentAccountId);
  for (const accountId of otherAccountIds) {
    const { sessionFile, username: likerUsername } = getAccountPaths(accountId);
    if (!fs.existsSync(sessionFile)) {
      logger.warn(MODULE, `crossLike: session not found for acct${accountId}`);
      continue;
    }
    let browser;
    try {
      browser = await launchBrowser({ headless: true });
      const ctx  = await browser.newContext({ storageState: sessionFile, viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(2_000);
      await clickLikeButton(page, `${noteId}(acct${accountId}→${likerUsername})`);
      await page.waitForTimeout(1_000);
    } catch (err) {
      logger.warn(MODULE, `crossLike acct${accountId} failed: ${err.message}`);
    } finally {
      await browser?.close();
    }
  }
}

export async function publishNote(page, draft, username = 'rascal_ai_devops') {
  // Step 1: 「公開に進む」クリック
  await takeDebugScreenshot(page, 'step1-before-publish-btn');
  const publishBtnSelectors = [
    'button:has-text("公開に進む")',
    'button:has-text("公開する")',
    'button:has-text("公開")',
    '[data-testid="publish-button"]',
  ];
  await tryClick(page, publishBtnSelectors, { label: 'step1-publish-btn', force: true });

  // 公開に進む → /publish/ ページへ遷移（SPA ナビゲーション）
  await page.waitForURL('**/publish/**', { timeout: 15_000 })
    .catch(() => logger.warn(MODULE, 'waitForURL /publish/ timed out'));
  await page.waitForSelector(
    'button:has-text("投稿する"), button:has-text("有料エリア設定"), button:has-text("更新する")',
    { timeout: 15_000 }
  ).catch(err => logger.warn(MODULE, `publish page load: ${err.message}`));
  await page.waitForTimeout(500);
  await takeDebugScreenshot(page, 'step2-modal-ready');
  logger.info(MODULE, `publish modal ready: ${page.url()}`);

  // Step 2: ハッシュタグ設定
  // note.com publish ページはアコーディオン構造 — ハッシュタグセクションを先に展開する
  const tags = draft.tags ?? draft.hashtags ?? [];
  if (tags.length > 0) {
    try {
      await takeDebugScreenshot(page, 'step2-before-hashtag');
      await tryClick(page, [
        'text=ハッシュタグ',
        'button:has-text("ハッシュタグ")',
        '[class*="hashtag"] button',
        '[class*="Hashtag"] button',
      ], { label: 'step2-hashtag-accordion' }).catch(() => {});
      await page.waitForTimeout(600);

      const tagInputSelectors = [
        'input[placeholder*="タグ"]',
        'input[placeholder*="ハッシュタグ"]',
        'input[placeholder*="追加"]',
        '[class*="hashtag"] input',
        '[class*="Hash"] input',
        '[class*="tag"] input[type="text"]',
      ];
      let tagInput = null;
      for (const sel of tagInputSelectors) {
        const el = page.locator(sel).first();
        if (await el.count() > 0) { tagInput = el; break; }
      }
      if (tagInput) {
        for (const tag of tags.slice(0, 10)) {
          const cleanTag = tag.replace(/^#/, '');
          await tagInput.click();
          await tagInput.fill('');
          await page.keyboard.type(cleanTag, { delay: 80 });
          await page.waitForTimeout(800);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(600);
        }
        logger.info(MODULE, `hashtags set: ${tags.join(', ')}`);
      } else {
        await takeDebugScreenshot(page, 'step2-hashtag-input-NOT_FOUND');
        logger.warn(MODULE, 'hashtag input not found on publish page');
      }
    } catch (err) {
      logger.warn(MODULE, `hashtag setting failed: ${err.message}`);
    }
  }

  // Step 3: 有料設定
  // note.com publish ページはアコーディオン構造 — 記事タイプセクションを先に展開する
  if (draft.price) {
    try {
      await takeDebugScreenshot(page, 'step3-before-paid');
      await tryClick(page, [
        'text=記事タイプ',
        'button:has-text("記事タイプ")',
        '[class*="articleType"] button',
      ], { label: 'step3-article-type-accordion' }).catch(() => {});
      await page.waitForTimeout(600);

      await tryClick(page, [
        'label:has-text("有料")',
        'input[type="radio"][value*="paid"]',
        'button:has-text("有料")',
        'span:has-text("有料")',
      ], { label: 'step3-paid-toggle' });

      await page.waitForTimeout(1_500);
      await takeDebugScreenshot(page, 'step3-after-paid-toggle');

      // 身元確認モーダルが出たら dismiss
      const idModal = page.locator('[class*="IdentificationModal"]').first();
      if (await idModal.count() > 0) {
        logger.warn(MODULE, '⚠ 身元確認モーダル検出 — 有料設定スキップ');
        await tryClick(page, [
          'button:has-text("閉じる")',
          'button:has-text("キャンセル")',
          '[aria-label="閉じる"]',
        ], { label: 'step3-id-modal-close' }).catch(() => {});
        await page.waitForTimeout(1_000);
      } else {
        logger.info(MODULE, 'paid toggle clicked');
        const priceSelectors = [
          'input[type="number"]',
          'input[placeholder*="価格"]',
          'input[placeholder*="円"]',
          'input[placeholder="300"]',
        ];
        let priceInput = null;
        for (const sel of priceSelectors) {
          const el = page.locator(sel).first();
          if (await el.count() > 0) { priceInput = el; break; }
        }
        if (priceInput) {
          await priceInput.scrollIntoViewIfNeeded();
          await priceInput.click({ clickCount: 3 });
          await priceInput.fill(String(draft.price));
          await page.waitForTimeout(400);
          logger.info(MODULE, `price set: ${draft.price}円`);
        } else {
          await takeDebugScreenshot(page, 'step3-price-input-NOT_FOUND');
          logger.warn(MODULE, 'price input not found after clicking 有料');
        }
      }
    } catch (err) {
      logger.warn(MODULE, `paid setting failed: ${err.message}`);
    }
  }

  // Step 4: 最終投稿ボタン
  // ハッシュタグ入力後 SPA が再レンダリングすることがあるので明示的に待つ
  // 「投稿する」はヘッダー固定位置(右上)にあるためスクロール不要
  await page.waitForTimeout(1_000);

  // 有料記事なら「有料エリア設定」、無料記事なら「投稿する」
  const confirmSelectors = draft.price
    ? [
        'button:has-text("有料エリア設定")',
        'button:has-text("投稿する")',
        'button:has-text("公開する")',
      ]
    : [
        'button:has-text("投稿する")',
        'button:has-text("公開する")',
        'button:has-text("今すぐ公開")',
        'button:has-text("noteに公開する")',
      ];

  // SPA 再レンダリング後にボタンが再出現するまで待つ
  await page.waitForSelector(confirmSelectors.join(', '), { timeout: 10_000 })
    .catch(err => logger.warn(MODULE, `step4 confirm btn wait: ${err.message}`));
  await takeDebugScreenshot(page, 'step4-before-confirm-btn');

  const confirmedSel = await tryClick(page, confirmSelectors, { label: 'step4-confirm-btn' });

  if (draft.price && confirmedSel.includes('有料エリア設定')) {
    // 有料エリア設定クリック後: 境界設定モーダルで freeBody 末尾に有料ラインを設定
    await page.waitForTimeout(1_000);
    await takeDebugScreenshot(page, 'step4-paid-boundary-modal');
    const freeParagraphs = (draft.freeBody ?? '')
      .split('\n\n')
      .filter(p => p.trim().length > 0).length;
    logger.info(MODULE, `freeBody paragraphs: ${freeParagraphs}`);
    try {
      const lineButtons = page.locator('button:has-text("ラインをこの場所に変更")');
      const count = await lineButtons.count();
      const idx = Math.min(freeParagraphs - 1, count - 1);
      if (count > 0 && idx >= 0) {
        await lineButtons.nth(idx).click();
        await page.waitForTimeout(800);
        logger.info(MODULE, `paid line set at paragraph ${idx + 1} of ${count}`);
      }
    } catch (err) {
      logger.warn(MODULE, `paid line click failed: ${err.message}`);
    }
    await tryClick(page, ['button:has-text("投稿する")'], { label: 'step4-paid-final-post' })
      .catch(err => logger.warn(MODULE, `step4-paid-final-post: ${err.message}`));
    logger.info(MODULE, 'paid article posted via 投稿する in boundary modal');
  }

  // 公開後 note URL への遷移を待つ
  let finalUrl = page.url();
  try {
    await page.waitForURL(/note\.com.*\/n\//, { timeout: 60_000 });
    finalUrl = page.url();
  } catch {
    const currentUrl = page.url();
    if (/editor\.note\.com\/notes\/n[a-z0-9]+\//.test(currentUrl)) {
      logger.warn(MODULE, `URL did not redirect — using editor URL: ${currentUrl}`);
      finalUrl = currentUrl;
    } else {
      await takeDebugScreenshot(page, 'step4-url-timeout-FAILED');
      throw new Error('URL transition to note.com/*/n/* timed out — article may not have published. NOT marking as posted.');
    }
  }
  logger.info(MODULE, `final URL: ${finalUrl}`);
  return finalUrl;
}

/**
 * 公開済み記事の編集差分を再公開する（「更新する」ボタンを押すだけ）
 * 既にエディタページを開いた状態で呼ぶ。
 */
export async function republishNote(page) {
  await tryClick(page, [
    'button:has-text("公開に進む")',
    'button:has-text("公開する")',
    'button:has-text("公開")',
  ], { label: 'republish-open-modal', force: true });

  await page.waitForSelector(
    'button:has-text("更新する"), button:has-text("投稿する")',
    { timeout: 12_000 }
  ).catch(() => {});
  await page.waitForTimeout(500);

  await tryClick(page, [
    'button:has-text("更新する")',
    'button:has-text("投稿する")',
  ], { label: 'republish-confirm' });

  await page.waitForTimeout(2_000);
  logger.info(MODULE, `republished: ${page.url()}`);
}
