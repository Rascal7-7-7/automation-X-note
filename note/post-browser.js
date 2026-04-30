/**
 * note 投稿 — Playwright 低レベル操作
 * Editor input, code blocks, cover image, debug helpers.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:post';

export const IS_MAC = process.platform === 'darwin';

// `` コードブロックをセグメントに分割する
export function splitBodySegments(bodyText) {
  const segments = [];
  const lines = bodyText.split('\n');
  let currentLines = [];
  let inCode = false;

  for (const line of lines) {
    if (!inCode && /^```/.test(line)) {
      if (currentLines.length) {
        segments.push({ type: 'text', content: currentLines.join('\n') });
        currentLines = [];
      }
      inCode = true;
    } else if (inCode && /^```\s*$/.test(line)) {
      segments.push({ type: 'code', content: currentLines.join('\n') });
      currentLines = [];
      inCode = false;
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length) {
    segments.push({ type: inCode ? 'code' : 'text', content: currentLines.join('\n') });
  }
  return segments;
}

// コードブロック付き本文をProseMirrorに挿入する
// - テキスト: クリップボードペースト
// - コードブロック: ``` + Enter でネイティブコードブロック作成
export async function insertNativeCodeBlock(page, codeContent) {
  const mod = IS_MAC ? 'Meta' : 'Control';

  const cursorY = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    return r.top + r.height / 2;
  });
  if (!cursorY) return false;

  const editorLeft = await page.evaluate(() =>
    document.querySelector('.ProseMirror')?.getBoundingClientRect().left ?? 400
  );
  await page.mouse.move(Math.max(editorLeft - 45, 10), cursorY);
  await page.waitForTimeout(500);

  const plusCoords = await page.evaluate((approxY) => {
    const btns = Array.from(document.querySelectorAll('button,[role="button"]'));
    const leftBtns = btns.filter(b => {
      const r = b.getBoundingClientRect();
      return r.x < 350 && r.x > 0 && r.width > 10 && r.width < 60 && r.height > 10;
    });
    leftBtns.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return Math.abs(ar.top - approxY) - Math.abs(br.top - approxY);
    });
    const t = leftBtns[0];
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, cursorY);

  if (!plusCoords) return false;

  await page.mouse.click(plusCoords.x, plusCoords.y);
  await page.waitForTimeout(700);

  const codeItem = page.locator([
    'button:has-text("コード")',
    '[role="menuitem"]:has-text("コード")',
    'li:has-text("コード")',
  ].join(', ')).first();

  if (await codeItem.count() === 0) return false;
  // メニューアイテムが DOM にあっても viewport 外の場合があるのでスクロール後に可視チェック
  await codeItem.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
  const isVisible = await codeItem.isVisible({ timeout: 1_000 }).catch(() => false);
  if (!isVisible) return false; // 呼び出し元の ``` フォールバックに委譲
  await codeItem.click();
  await page.waitForTimeout(400);

  if (codeContent) {
    await page.evaluate(t => navigator.clipboard.writeText(t), codeContent);
    await page.keyboard.press(`${mod}+v`);
    await page.waitForTimeout(200);
  }

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  return true;
}

export async function pasteTextToEditor(page, text) {
  const mod = IS_MAC ? 'Meta' : 'Control';
  const charsBefore = await page.evaluate(() =>
    document.querySelector('div.ProseMirror')?.textContent?.length ?? 0
  );
  // clipboard paste (primary)
  await page.evaluate(t => navigator.clipboard.writeText(t), text);
  await page.waitForTimeout(100);
  await page.keyboard.press(`${mod}+v`);
  await page.waitForTimeout(400);
  const charsAfter = await page.evaluate(() =>
    document.querySelector('div.ProseMirror')?.textContent?.length ?? 0
  );
  if (charsAfter <= charsBefore) {
    // clipboard failed — fall back to insertText (CDP direct input)
    await page.keyboard.insertText(text);
    await page.waitForTimeout(300);
  }
}

export async function typeBodyWithCodeBlocks(page, bodyText) {
  const segments = splitBodySegments(bodyText);
  const mod = IS_MAC ? 'Meta' : 'Control';
  let first = true;

  // エディタにフォーカスを当てる
  const editor = page.locator('div.ProseMirror[role="textbox"]').first();
  await editor.click();
  await page.waitForTimeout(300);

  for (const seg of segments) {
    if (seg.type === 'text' && seg.content.trim()) {
      if (first) {
        await page.keyboard.press(`${mod}+a`);
        first = false;
      }
      await pasteTextToEditor(page, seg.content);
    } else if (seg.type === 'code') {
      await editor.click();
      await page.keyboard.press(`${mod}+End`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);

      // ``` トリガーをプライマリとして使用（UIメニュークリックより信頼性が高い）
      await page.keyboard.type('```');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      if (seg.content) {
        await page.evaluate(t => navigator.clipboard.writeText(t), seg.content);
        await page.keyboard.press(`${mod}+v`);
        await page.waitForTimeout(200);
      }
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      first = false;
    }
  }
}

export async function insertPaidSection(page, editor, bodyText) {
  // エディタ内での有料ライン挿入は note.com が対応していないため、
  // 全文（freeBody + paidBody）を本文に入力する。
  // 有料ライン境界は公開モーダルの「ラインをこの場所に変更」ボタンで設定する。
  await editor.click();
  await typeBodyWithCodeBlocks(page, bodyText);
}

// ── ヘッダー画像アップロード ────────────────────────────────────────
export async function uploadCoverImage(page, imagePath) {
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
export async function takeDebugScreenshot(page, label) {
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
export async function tryClick(page, selectors, { label = '', force = false } = {}) {
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
