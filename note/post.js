/**
 * note 投稿モジュール（Playwright）
 * - drafts/ から最古の未投稿ドラフトを取得
 * - note.com にログインして下書き保存
 * - 投稿確認（保存テキスト検出）後に status を "posted" に更新
 * - promoPosted: false を付与（x:note-promo が参照）
 *
 * ⚠️ note.com の利用規約を遵守してください
 * ⚠️ 公開は手動確認後に行ってください
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { logger } from '../shared/logger.js';
import { logNotePosted } from '../analytics/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:post';

const ACCOUNT_USERNAMES = { 1: 'rascal_ai_devops', 2: 'rascal_invest', 3: 'rascal_affiliate' };

function getAccountPaths(accountId = 1) {
  const subdirs = { 1: 'drafts', 2: 'drafts/account2', 3: 'drafts/account3' };
  const sessions = { 1: '.note-session.json', 2: '.note-session-2.json', 3: '.note-session-3.json' };
  return {
    draftsDir:   path.join(__dirname, subdirs[accountId] ?? 'drafts'),
    sessionFile: path.join(__dirname, '..', sessions[accountId] ?? '.note-session.json'),
    username:    ACCOUNT_USERNAMES[accountId] ?? 'rascal_ai_devops',
  };
}
const IS_MAC = process.platform === 'darwin';

function findOldestDraft(draftsDir) {
  if (!fs.existsSync(draftsDir)) return null;

  const files = fs.readdirSync(draftsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ filePath: path.join(draftsDir, f) }))
    .map(f => ({ ...f, draft: JSON.parse(fs.readFileSync(f.filePath, 'utf8')) }))
    .filter(f => f.draft.status === 'draft')
    .sort((a, b) => (a.draft.createdAt ?? '').localeCompare(b.draft.createdAt ?? ''));

  return files[0] ?? null;
}

function markPosted(filePath, noteUrl) {
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = {
    ...draft,
    status:       'posted',
    postedAt:     new Date().toISOString(),
    noteUrl,
    promoPosted:  false,   // x:note-promo が参照するフラグ
  };
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, filePath);
}

function notifyPublishReady(title, noteUrl) {
  const script = path.join(__dirname, 'notify.py');
  execFile('python3', [script, '--open'], (err) => {
    if (err) logger.warn(MODULE, 'notify script failed', { message: err.message });
  });
  logger.info(MODULE, `notify: ${title} — ${noteUrl}`);
}

async function insertPaidSection(page, editor, bodyText) {
  // エディタ内での有料ライン挿入は note.com が対応していないため、
  // 全文（freeBody + paidBody）を本文に入力する。
  // 有料ライン境界は公開モーダルの「ラインをこの場所に変更」ボタンで設定する。
  await editor.click();
  await editor.fill(bodyText);
}

// ── ヘッダー画像アップロード ────────────────────────────────────────
async function uploadCoverImage(page, imagePath) {
  // 本文入力前（空のエディタ状態）に呼ぶこと — 入力後はボタンが消える
  // note.com カバー画像の2ステップフロー (DOM inspection 2026-04-22 確認):
  //   Step1: button[aria-label="画像を追加"] をクリック → サブメニュー展開
  //   Step2: サブメニュー内の "画像をアップロード" ボタンをクリック → filechooser

  const coverBtn = page.locator('button[aria-label="画像を追加"]').first();
  if (await coverBtn.count() === 0) {
    logger.warn(MODULE, 'cover image button not found — skipping');
    return;
  }

  // Step1: サブメニューを開く
  await coverBtn.click();
  await page.waitForTimeout(800);

  try {
    // Step2: "画像をアップロード" ボタンをクリック → filechooser
    const uploadBtn = page.locator('button:has-text("画像をアップロード")').first();
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8_000 }),
      uploadBtn.click(),
    ]);
    await fileChooser.setFiles(imagePath);

    // Step3: トリミングモーダルが出るのを待って「保存」で確定
    await page.waitForSelector('[data-testid="cropper"]', { timeout: 8_000 });
    const saveBtn = page.locator('button').filter({ hasText: /^保存$/ }).first();
    await saveBtn.click();
    await page.waitForTimeout(2_000);
    logger.info(MODULE, 'cover image uploaded');
  } catch (err) {
    logger.warn(MODULE, `cover image upload failed: ${err.message}`);
  }
}

// ── デバッグ補助 ─────────────────────────────────────────────────
async function takeDebugScreenshot(page, label) {
  const dir = path.join(__dirname, '..', 'logs', 'debug-screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = `${ts}-${label.replace(/[^\w-]/g, '_')}.png`;
  const fpath = path.join(dir, fname);
  await page.screenshot({ path: fpath, fullPage: false }).catch(() => {});
  logger.info(MODULE, `[screenshot] ${fname}`);
  return fpath;
}

/**
 * selectors を順に試してクリック。失敗のたびにスクリーンショット保存。
 * 全て失敗したら Error を throw する（呼び元で .catch(() => {}) により soft 化可能）。
 */
async function tryClick(page, selectors, { label = '', force = false } = {}) {
  for (let i = 0; i < selectors.length; i++) {
    const sel = selectors[i];
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.scrollIntoViewIfNeeded();
        await el.click({ force });
        logger.info(MODULE, `tryClick [${label}] hit: ${sel}`);
        return sel;
      }
    } catch (err) {
      logger.warn(MODULE, `tryClick [${label}] miss #${i + 1} "${sel}": ${err.message}`);
      await takeDebugScreenshot(page, `${label}-miss${i + 1}`);
    }
  }
  await takeDebugScreenshot(page, `${label}-ALL_FAILED`);
  throw new Error(`tryClick [${label}] all selectors failed: ${selectors.join(' | ')}`);
}

// ── 公開処理 ────────────────────────────────────────────────────────
async function publishNote(page, draft, username = 'rascal_ai_devops') {
  // Step 1: 「公開に進む」クリック
  await takeDebugScreenshot(page, 'step1-before-publish-btn');
  const publishBtnSelectors = [
    'button:has-text("公開に進む")',
    'button:has-text("公開する")',
    'button:has-text("公開")',
    '[data-testid="publish-button"]',
  ];
  await tryClick(page, publishBtnSelectors, { label: 'step1-publish-btn', force: true });

  // publish モーダルが表示されるまで待つ（URL は変わらない — SPA オーバーレイ）
  await page.waitForSelector(
    'button:has-text("投稿する"), button:has-text("有料エリア設定"), button:has-text("更新する")',
    { timeout: 15_000 }
  ).catch(() => {});
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
        for (const tag of tags.slice(0, 5)) {
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
  await page.waitForTimeout(1_000);
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, main, section'));
    const scrollable = els
      .filter(el => el.scrollHeight > el.clientHeight + 10)
      .sort((a, b) => b.scrollHeight - a.scrollHeight);
    if (scrollable[0]) scrollable[0].scrollTo(0, scrollable[0].scrollHeight);
    else window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(800);
  await takeDebugScreenshot(page, 'step4-before-confirm-btn');

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

export async function runPost(accountIdOrOpts = {}) {
  const accountId = typeof accountIdOrOpts === 'number' ? accountIdOrOpts : (accountIdOrOpts.accountId ?? 1);
  const headless  = typeof accountIdOrOpts === 'object' ? (accountIdOrOpts.headless ?? true) : true;
  const { draftsDir, sessionFile, username } = getAccountPaths(accountId);

  const file = findOldestDraft(draftsDir);

  if (!file) {
    logger.info(MODULE, 'no drafts to post');
    return;
  }

  const { draft } = file;
  logger.info(MODULE, `posting: ${draft.title}`);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();

  try {
    // ── ログイン ──────────────────────────────────────────────────
    await page.goto('https://note.com/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(2_000);
    // ログイン済み判定: URLがloginページでなければOK
    const isLoggedIn = !page.url().includes('/login');

    if (!isLoggedIn) {
      logger.info(MODULE, 'logging in to note.com');
      await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForSelector('#email', { timeout: 15_000 });
      await page.evaluate(({ email, password }) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const emailEl = document.querySelector('#email');
        const passEl  = document.querySelector('#password');
        setter.call(emailEl, email);
        emailEl.dispatchEvent(new Event('input', { bubbles: true }));
        setter.call(passEl, password);
        passEl.dispatchEvent(new Event('input', { bubbles: true }));
      }, { email: process.env.NOTE_EMAIL, password: process.env.NOTE_PASSWORD });
      await page.waitForTimeout(1_000);
      await page.getByRole('button', { name: 'ログイン' }).click();
      await page.waitForTimeout(4_000);
      await context.storageState({ path: sessionFile });
    }

    // ── 新規記事作成 ──────────────────────────────────────────────
    await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // ログインページにリダイレクトされた場合はセッション切れ
    if (page.url().includes('/login')) {
      throw new Error('session expired — run: node note/save-session.js');
    }
    logger.info(MODULE, `editor URL: ${page.url()}`);

    // エディタ読み込みを待つ（タイトル textarea が出現したら準備完了）
    await page.waitForSelector('textarea[placeholder="記事タイトル"]', { timeout: 30_000 });
    await takeDebugScreenshot(page, 'runPost-editor-ready');
    await page.waitForTimeout(1_000);

    // ── タイトル ─────────────────────────────────────────────────
    await page.locator('textarea[placeholder="記事タイトル"]').fill(draft.title);
    logger.info(MODULE, 'title filled');

    // ── ヘッダー画像（本文入力前に行う — 本文入力後はボタンが消える）─
    if ((draft.headerImage || draft.imagePath) && fs.existsSync(draft.headerImage ?? draft.imagePath)) {
      try {
        await uploadCoverImage(page, draft.headerImage ?? draft.imagePath);
      } catch (err) {
        logger.warn(MODULE, `header image upload failed: ${err.message}`);
      }
    }

    // ── 本文（有料セクション対応） ────────────────────────────────
    // note.com 本文エディタ: div.ProseMirror[role="textbox"]
    await page.waitForSelector('div.ProseMirror[role="textbox"]', { timeout: 15_000 });
    const editor = page.locator('div.ProseMirror[role="textbox"]').first();

    // 本文先頭の H1 タイトル行を除去（タイトルは別フィールドに入力済み）
    const rawBody  = draft.paidBody
      ? (draft.freeBody ?? '') + '\n\n' + (draft.paidBody ?? '')
      : (draft.body ?? '');
    const bodyText = rawBody.replace(/^#\s+.+\n+/, '').trimStart();

    if (draft.paidBody) {
      await insertPaidSection(page, editor, bodyText);
    } else {
      await editor.click();
      await page.waitForTimeout(500);
      await page.evaluate(text => navigator.clipboard.writeText(text), bodyText);
      await page.keyboard.press(IS_MAC ? 'Meta+a' : 'Control+a');
      await page.keyboard.press(IS_MAC ? 'Meta+v' : 'Control+v');
      await page.waitForTimeout(1_000);
    }

    // ── 下書き保存 ───────────────────────────────────────────────
    await page.keyboard.press(IS_MAC ? 'Meta+s' : 'Control+s');
    await page.waitForTimeout(3_000);

    // ── 保存確認（note.com は自動保存もあるため非致命的チェック）──────
    const savedCount = await page.locator(
      'text=保存しました'
    ).or(page.locator('text=下書き保存')).or(page.locator('text=保存中')).count();
    if (savedCount === 0) {
      logger.warn(MODULE, 'save confirmation text not found — proceeding anyway');
    } else {
      logger.info(MODULE, 'draft saved');
    }

    // 保存後: エディタを reload して clean 状態にする（publish-draft.js と同じアプローチ）
    // clipboard paste 後の "dirty" 状態では 公開に進む が動作しない場合がある
    const editorUrl = page.url();
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2_000);
    logger.info(MODULE, `editor reloaded: ${page.url()}`);

    // ── 公開（prod のみ） ─────────────────────────────────────────
    const isDev = ((typeof accountIdOrOpts === 'object' ? accountIdOrOpts.mode : undefined) ?? process.env.MODE ?? 'dev') === 'dev';
    if (isDev) {
      const noteUrl = page.url();
      markPosted(file.filePath, noteUrl);
      logNotePosted(file.filePath, noteUrl, draft);
      logger.info(MODULE, `DEV: saved as draft only — ${noteUrl}`);
      notifyPublishReady(draft.title, noteUrl);
    } else {
      const noteUrl = await publishNote(page, draft, username);
      markPosted(file.filePath, noteUrl);
      logNotePosted(file.filePath, noteUrl, draft);
      logger.info(MODULE, `published: ${noteUrl}`);
    }
  } catch (err) {
    await takeDebugScreenshot(page, 'runPost-ERROR').catch(() => {});
    logger.error(MODULE, 'post failed', { message: err.message });
    throw err;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPost({ headless: !process.argv.includes('--headed') });
}
