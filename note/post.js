/**
 * note 投稿モジュール（Playwright）— エントリーポイント
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
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { IS_MAC, uploadCoverImage, insertPaidSection, typeBodyWithCodeBlocks, takeDebugScreenshot } from './post-browser.js';
import { publishNote, selfLikeNote, crossLikeNote } from './post-publish.js';

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
  saveJSON(filePath, updated);
}

function notifyPublishReady(title, noteUrl) {
  const script = path.join(__dirname, 'notify.py');
  execFile('python3', [script, '--open'], (err) => {
    if (err) logger.warn(MODULE, 'notify script failed', { message: err.message });
  });
  logger.info(MODULE, `notify: ${title} — ${noteUrl}`);
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

    // エディタ読み込みを待つ
    await page.waitForSelector(
      'textarea[placeholder="記事タイトル"], [placeholder="記事タイトル"], div.ProseMirror',
      { timeout: 30_000 }
    );
    await page.waitForTimeout(1_000);

    // "AIと相談" パネルを閉じる（フォーカス奪取を防ぐ）
    const aiPanelClose = page.locator('button[aria-label="閉じる"], button:has-text("×"), .ai-assistant button.close').first();
    if (await aiPanelClose.count() > 0) {
      await aiPanelClose.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    // X ボタン（SVG inside button）でも閉じる
    const aiPanel = page.locator('.AIAssistant, [class*="ai-assistant"], [class*="AiAssistant"]').first();
    if (await aiPanel.count() > 0) {
      const xBtn = aiPanel.locator('button').first();
      await xBtn.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    await takeDebugScreenshot(page, 'runPost-editor-ready');

    // ── タイトル ─────────────────────────────────────────────────
    // 1) textarea の fill を試みる
    const titleTextarea = page.locator('textarea[placeholder="記事タイトル"]').first();
    const titleDiv      = page.locator('[placeholder="記事タイトル"]:not(textarea), h1[contenteditable], .title-input[contenteditable]').first();

    if (await titleTextarea.count() > 0) {
      await titleTextarea.click();
      await titleTextarea.fill(draft.title);
    } else if (await titleDiv.count() > 0) {
      await titleDiv.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(draft.title, { delay: 0 });
    } else {
      // フォールバック: ProseMirror 先頭行にタイトルを入力
      const ed = page.locator('div.ProseMirror[role="textbox"]').first();
      await ed.click();
      await page.keyboard.press('Control+Home');
      await page.keyboard.type(draft.title, { delay: 0 });
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(500);
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

    await editor.click();
    await page.waitForTimeout(500);
    if (draft.paidBody) {
      await insertPaidSection(page, editor, bodyText);
    } else {
      await typeBodyWithCodeBlocks(page, bodyText);
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
      await selfLikeNote(page, noteUrl, username);
      await crossLikeNote(noteUrl, username, accountId, getAccountPaths);
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
