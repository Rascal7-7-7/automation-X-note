/**
 * 既存のnote記事にカバー画像を追加するスクリプト
 * Usage: node note/add-cover.js <noteId> <imagePath>
 * Example: node note/add-cover.js n8154b39ba0f0 /path/to/image.png
 */
import 'dotenv/config';
import { getBraveBrowser } from '../x/browser-client.js';
import { logger } from '../shared/logger.js';

const MODULE = 'note:add-cover';

const noteId    = process.argv[2] ?? 'n8154b39ba0f0';
const imagePath = process.argv[3] ?? '/Users/Rascal/work/automation/.tmp-note-images/header-1776840854503.png';

const { browser, page } = await getBraveBrowser();
try {
  const editorUrl = `https://editor.note.com/notes/${noteId}/edit/`;
  logger.info(MODULE, `opening editor: ${editorUrl}`);
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(4_000);

  if (page.url().includes('/login')) {
    logger.error(MODULE, 'session expired');
    process.exit(1);
  }

  // Check if cover image button exists
  const coverBtn = page.locator('button[aria-label="画像を追加"]').first();
  if (await coverBtn.count() === 0) {
    logger.warn(MODULE, 'cover image button not found — article may already have a cover');
    process.exit(0);
  }

  // Step1: open submenu
  await coverBtn.click();
  await page.waitForTimeout(800);

  // Step2: click upload button
  const uploadBtn = page.locator('button:has-text("画像をアップロード")').first();
  if (await uploadBtn.count() === 0) {
    logger.warn(MODULE, 'upload button not found');
    process.exit(1);
  }

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8_000 }),
    uploadBtn.click(),
  ]);
  await fileChooser.setFiles(imagePath);

  // Step3: wait for crop modal and confirm
  await page.waitForSelector('[data-testid="cropper"]', { timeout: 8_000 });
  const saveBtn = page.locator('button').filter({ hasText: /^保存$/ }).first();
  await saveBtn.click();
  await page.waitForTimeout(2_000);
  logger.info(MODULE, 'cover image uploaded');

  // Save as draft to persist the cover image
  const draftSaveBtn = page.locator('button:has-text("下書き保存")').first();
  if (await draftSaveBtn.count() > 0) {
    await draftSaveBtn.click();
    await page.waitForTimeout(2_000);
    logger.info(MODULE, 'draft saved with cover image');
  }

  logger.info(MODULE, `done: ${editorUrl}`);
} finally {
  await browser.close();
}
