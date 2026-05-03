/**
 * note 記事内プレースホルダー削除スクリプト
 *
 * requiresManualInsertion フラグが付いた記事のプレースホルダーテキストを
 * エディタから削除して保存する。
 *
 * 使い方:
 *   node note/delete-placeholders.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, launchChromeProfileContext } from '../shared/browser-launch.js';
import { getAccount } from './accounts.js';
import { saveJSON } from '../shared/file-utils.js';
import { logger } from '../shared/logger.js';
import { takeDebugScreenshot } from './post-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE    = 'note:delete-placeholders';
const IS_MAC    = process.platform === 'darwin';

const ACCOUNT_DRAFT_DIRS = {
  1: path.join(__dirname, 'drafts'),
  2: path.join(__dirname, 'drafts/account2'),
  3: path.join(__dirname, 'drafts/account3'),
};

function toEditorUrl(noteUrl) {
  if (/editor\.note\.com/.test(noteUrl)) {
    return noteUrl.replace(/\/(publish|edit)\/?$/, '/edit/');
  }
  const m = noteUrl.match(/\/n\/(n[a-z0-9]+)/);
  if (m) return `https://editor.note.com/notes/${m[1]}/edit/`;
  return null;
}

// requiresManualInsertion 記事を収集
function collectTargets() {
  const targets = [];
  for (const [acctId, dir] of Object.entries(ACCOUNT_DRAFT_DIRS)) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const fp = path.join(dir, file);
      try {
        const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (d.status !== 'posted') continue;
        const manuals = (d.sectionImages ?? []).filter(s => s.requiresManualInsertion && !s.deletedAt);
        if (manuals.length === 0) continue;
        const editorUrl = toEditorUrl(d.noteUrl ?? '');
        if (!editorUrl) continue;
        const noteId = (d.noteUrl ?? '').match(/\/notes\/(n[a-z0-9]+)/)?.[1] ?? '?';
        targets.push({ fp, draft: d, accountId: Number(acctId), noteId, editorUrl, manuals });
      } catch { /* skip */ }
    }
  }
  return targets;
}

async function buildContext(accountId) {
  const { chromeProfile } = getAccount(accountId);
  const sessionFiles = { 1: '.note-session.json', 2: '.note-session-2.json', 3: '.note-session-3.json' };
  const sessionFile  = path.join(__dirname, '..', sessionFiles[accountId] ?? '.note-session.json');

  if (chromeProfile) {
    logger.info(MODULE, `trying Chrome profile: ${chromeProfile}`);
    try {
      const ctx = await launchChromeProfileContext(chromeProfile);
      const pg  = await ctx.newPage();
      await pg.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await pg.waitForTimeout(2_000);
      if (pg.url().includes('/login')) {
        await pg.waitForTimeout(2_500);
        await pg.getByRole('button', { name: 'ログイン' }).click().catch(() => {});
        await pg.waitForTimeout(5_000);
      }
      if (!pg.url().includes('/login')) return { context: ctx, page: pg, browser: null };
      logger.warn(MODULE, `Chrome profile not authenticated — falling back to session file`);
      await ctx.close();
    } catch (err) {
      logger.warn(MODULE, `Chrome profile launch failed: ${err.message} — falling back to session file`);
    }
  }
  if (!fs.existsSync(sessionFile)) throw new Error(`no session file for acct${accountId}: ${sessionFile}`);
  const browser = await launchBrowser({ headless: true });
  const ctx = await browser.newContext({
    storageState: sessionFile,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  return { context: ctx, page: await ctx.newPage(), browser };
}

// エディタ内の📊プレースホルダー要素を全て削除
async function deletePlaceholdersFromEditor(page, noteId) {
  const editor = page.locator('div.ProseMirror[role="textbox"]').first();
  let deletedCount = 0;

  // 全ての要素を対象に📊を含むものを削除（複数回ループ、削除で再レンダリングされるため）
  for (let attempt = 0; attempt < 10; attempt++) {
    // Use Playwright filter to find the most specific element containing the placeholder
    const targetEl = editor.locator('blockquote, p').filter({ hasText: '[ここに画像:' }).first();
    const count = await targetEl.count();
    if (count === 0) break;

    const txt = await targetEl.textContent().catch(() => '');
    logger.info(MODULE, `[${noteId}] deleting: ${txt.slice(0, 60)}`);

    await targetEl.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await targetEl.click();
    await page.waitForTimeout(100);
    await targetEl.click({ clickCount: 3 });
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);
    deletedCount++;
  }

  return deletedCount;
}

async function processArticle({ draft, accountId, noteId, editorUrl, manuals }) {
  logger.info(MODULE, `opening editor: ${editorUrl}`);
  const { context, page, browser } = await buildContext(accountId);

  try {
    await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_000);
    if (page.url().includes('/login')) {
      throw new Error(`acct${accountId} not authenticated — refresh session: node note/save-session.js`);
    }

    await page.waitForSelector('div.ProseMirror[role="textbox"]', { timeout: 35_000 });
    await page.waitForTimeout(1_500);
    await takeDebugScreenshot(page, `delete-ph-${noteId}-ready`);

    const deleted = await deletePlaceholdersFromEditor(page, noteId);
    logger.info(MODULE, `${draft.title}: ${deleted} placeholder(s) deleted`);

    if (deleted > 0) {
      await page.keyboard.press(IS_MAC ? 'Meta+s' : 'Control+s');
      await page.waitForTimeout(2_500);
      await takeDebugScreenshot(page, `delete-ph-${noteId}-saved`);

      // 公開記事の場合: /publish/ → 更新する で reader 向けにも反映
      const publishUrl = page.url().replace(/\/edit\/?$/, '/publish/');
      logger.info(MODULE, `navigating to publish page: ${publishUrl}`);
      await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_000);
      await takeDebugScreenshot(page, `delete-ph-${noteId}-publish-page`);

      const updateBtn = page.locator('button:has-text("更新する"), button:has-text("投稿する")').first();
      if (await updateBtn.count() > 0) {
        await updateBtn.click();
        await page.waitForTimeout(3_000);
        await takeDebugScreenshot(page, `delete-ph-${noteId}-updated`);
        logger.info(MODULE, `published update: ${noteId}`);
      } else {
        logger.warn(MODULE, `update button not found for ${noteId} — changes saved as draft only`);
      }
    }
    return deleted;
  } finally {
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  const targets = collectTargets();
  if (targets.length === 0) {
    logger.info(MODULE, 'no articles with requiresManualInsertion placeholders');
    return;
  }
  logger.info(MODULE, `${targets.length} article(s) to clean up`);

  for (const target of targets) {
    logger.info(MODULE, `--- ${target.draft.title} (acct${target.accountId}) ---`);
    try {
      const deleted = await processArticle(target);
      // 削除済みとしてマーク
      const updatedSI = (target.draft.sectionImages ?? []).map(s =>
        s.requiresManualInsertion && !s.deletedAt
          ? { ...s, deletedAt: new Date().toISOString() }
          : s
      );
      const updated = { ...target.draft, sectionImages: updatedSI };
      saveJSON(target.fp, updated);
      logger.info(MODULE, `draft updated: ${target.fp.split('/').pop()}`);
    } catch (err) {
      logger.error(MODULE, `FAILED: ${target.draft.title}`, { message: err.message });
    }
  }
  logger.info(MODULE, 'all done');
}

main().catch(err => { logger.error(MODULE, 'fatal', { message: err.message }); process.exit(1); });
