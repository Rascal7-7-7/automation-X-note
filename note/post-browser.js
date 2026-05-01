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

// ── 記事内画像挿入 ────────────────────────────────────────────────
// insert-article-images.js と post.js の両方から使用する共通関数

/**
 * ProseMirror 内の「📊 [ここに画像: ...]」blockquote を imagePath の画像に置換する。
 * idx は同一記事内での連番（デバッグスクリーンショット名に使用）。
 * 成功時 true、失敗時 false を返す。
 */
export async function insertImageAtPlaceholder(page, description, imagePath, idx = 0) {
  const shortDesc = description.slice(0, 20);
  const prefix    = `img-insert-${idx}`;
  const editor    = page.locator('div.ProseMirror[role="textbox"]').first();

  // Step1: 対象blockquote（または段落）を特定
  const bqs = editor.locator('blockquote');
  let targetEl = null;
  const bqCount = await bqs.count();
  for (let i = 0; i < bqCount; i++) {
    const txt = await bqs.nth(i).textContent().catch(() => '');
    if (txt.includes('📊') && txt.includes(shortDesc.slice(0, 8))) { targetEl = bqs.nth(i); break; }
  }
  if (!targetEl) {
    for (let i = 0; i < bqCount; i++) {
      const txt = await bqs.nth(i).textContent().catch(() => '');
      if (txt.includes('📊')) { targetEl = bqs.nth(i); break; }
    }
  }
  // フォールバック: blockquoteでなく段落として入力された場合
  if (!targetEl) {
    const paras = editor.locator('p');
    const pCount = await paras.count();
    for (let i = 0; i < Math.min(pCount, 80); i++) {
      const txt = await paras.nth(i).textContent().catch(() => '');
      if (txt.includes('📊') && txt.includes(shortDesc.slice(0, 8))) { targetEl = paras.nth(i); break; }
    }
    if (!targetEl) {
      for (let i = 0; i < Math.min(pCount, 80); i++) {
        const txt = await paras.nth(i).textContent().catch(() => '');
        if (txt.includes('📊')) { targetEl = paras.nth(i); break; }
      }
    }
  }
  if (!targetEl) {
    logger.warn(MODULE, `[${prefix}] placeholder not found: ${shortDesc}`);
    await takeDebugScreenshot(page, `${prefix}-NOT_FOUND`);
    return false;
  }

  // Step2: 要素全体を選択して削除
  await targetEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await targetEl.click();
  await page.waitForTimeout(200);
  await targetEl.click({ clickCount: 3 });
  await page.waitForTimeout(200);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(700);

  // Step3: カーソル位置を取得してスクロール
  await page.evaluate(() => {
    const sel = window.getSelection();
    const node = sel?.getRangeAt(0)?.startContainer;
    if (node) {
      const el = node.nodeType === 3 ? node.parentElement : node;
      el?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  });
  await page.waitForTimeout(400);

  const cursorY = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return 400;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    return Math.min(Math.max(r.top + r.height / 2, 60), 800);
  });

  // 戦略A: カーソル行の左マージンにホバーして「+」ボタンを探す
  for (const hoverX of [50, 30, 70]) {
    await page.mouse.move(hoverX, cursorY);
    await page.waitForTimeout(500);

    // DOM評価でボタンを特定
    const nearBtn = await page.evaluate((y) => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const near = btns.filter(b => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.x < 180 && Math.abs((r.top + r.height / 2) - y) < 60;
      });
      return near.map(b => ({
        cls: b.className.slice(0, 120),
        txt: b.textContent?.trim().slice(0, 8),
        aria: b.getAttribute('aria-label'),
        x: Math.round(b.getBoundingClientRect().x + b.getBoundingClientRect().width / 2),
        y: Math.round(b.getBoundingClientRect().y + b.getBoundingClientRect().height / 2),
      }));
    }, cursorY);

    logger.info(MODULE, `[${prefix}] left-margin buttons at y=${cursorY}: ${JSON.stringify(nearBtn)}`);

    if (nearBtn.length > 0) {
      await page.mouse.click(nearBtn[0].x, nearBtn[0].y);
      await page.waitForTimeout(600);
      const imgOpt = page.locator('button, [role="menuitem"], [role="option"], li')
        .filter({ hasText: '画像' }).filter({ visible: true }).first();
      if (await imgOpt.count() > 0) {
        try {
          const [fc] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 8_000 }),
            imgOpt.click(),
          ]);
          await fc.setFiles(imagePath);
          await page.waitForTimeout(3_000);
          logger.info(MODULE, `[${prefix}] inserted via + menu`);
          return true;
        } catch { /* try next strategy */ }
      }
      await page.keyboard.press('Escape');
      break;
    }
  }

  // 戦略B: スラッシュコマンド /画像
  await page.keyboard.type('/');
  await page.waitForTimeout(900);
  await takeDebugScreenshot(page, `${prefix}-after-slash`);
  const slashImg = page.locator('button, [role="menuitem"], [role="option"], li')
    .filter({ hasText: '画像' }).filter({ visible: true }).first();
  if (await slashImg.count() > 0) {
    try {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8_000 }),
        slashImg.click(),
      ]);
      await fc.setFiles(imagePath);
      await page.waitForTimeout(3_000);
      logger.info(MODULE, `[${prefix}] inserted via slash command`);
      return true;
    } catch { /* fall through */ }
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');

  // 戦略C: 隠し file input を直接操作
  const fileInputs = page.locator('input[type="file"]');
  const fiCount = await fileInputs.count();
  for (let fi = 0; fi < fiCount; fi++) {
    try {
      await fileInputs.nth(fi).setFiles(imagePath);
      await page.waitForTimeout(3_000);
      logger.info(MODULE, `[${prefix}] inserted via file input[${fi}]`);
      return true;
    } catch { /* next */ }
  }

  // 戦略D: クリップボード経由ペースト
  try {
    const imgBase64 = fs.readFileSync(imagePath).toString('base64');
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob  = new Blob([bytes], { type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }, imgBase64);
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(3_000);
    logger.info(MODULE, `[${prefix}] inserted via clipboard paste`);
    return true;
  } catch (err) {
    logger.warn(MODULE, `[${prefix}] clipboard strategy failed: ${err.message}`);
  }

  await takeDebugScreenshot(page, `${prefix}-ALL_FAILED`);
  logger.warn(MODULE, `[${prefix}] all insertion strategies failed`);
  return false;
}

/**
 * draft.sectionImages の全エントリを順番に挿入する。
 * sectionImages: [{ placeholder: string, imagePath: string }]
 */
export async function insertSectionImages(page, sectionImages = []) {
  if (!sectionImages.length) return;
  let ok = 0;
  for (let i = 0; i < sectionImages.length; i++) {
    const { placeholder, imagePath } = sectionImages[i];
    if (!imagePath || !fs.existsSync(imagePath)) {
      logger.warn(MODULE, `section image missing: ${imagePath}`);
      continue;
    }
    const success = await insertImageAtPlaceholder(page, placeholder, imagePath, i);
    if (success) ok++;
  }
  logger.info(MODULE, `section images inserted: ${ok}/${sectionImages.length}`);
}
