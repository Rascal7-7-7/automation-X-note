/**
 * 既存公開記事のカバー画像一括追加
 * status=posted でヘッダー画像ファイルが存在する全記事にカバー画像を追加
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBraveBrowser } from '../x/browser-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:batch-cover';

const base = path.join(__dirname, 'drafts');
const dirs = [base, path.join(base, 'account2'), path.join(base, 'account3')];

const articles = [];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('account'))) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (d.status !== 'posted') continue;
      const imgPath = d.headerImage ?? d.imagePath ?? '';
      if (!imgPath || !fs.existsSync(imgPath)) continue;
      const noteUrl = d.noteUrl ?? '';
      // extract note ID from URL: /n/nXXXXXX
      const m = noteUrl.match(/\/n\/(n[a-z0-9]+)/);
      if (!m) continue;
      articles.push({ noteId: m[1], imagePath: imgPath, title: (d.title ?? '').slice(0, 40) });
    } catch {}
  }
}

logger.info(MODULE, `found ${articles.length} posted articles with header images`);

const { browser, page } = await getBraveBrowser();
let added = 0, skipped = 0, failed = 0;

try {
  for (const { noteId, imagePath, title } of articles) {
    logger.info(MODULE, `checking: ${title} (${noteId})`);
    try {
      const editorUrl = `https://editor.note.com/notes/${noteId}/edit/`;
      await page.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(3_000);

      const coverBtn = page.locator('button[aria-label="画像を追加"]').first();
      if (await coverBtn.count() === 0) {
        logger.info(MODULE, `  → already has cover, skipping`);
        skipped++;
        continue;
      }

      // 3-step cover image upload
      await coverBtn.click();
      await page.waitForTimeout(800);

      const uploadBtn = page.locator('button:has-text("画像をアップロード")').first();
      if (await uploadBtn.count() === 0) {
        logger.warn(MODULE, `  → upload button not found`);
        failed++;
        continue;
      }

      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8_000 }),
        uploadBtn.click(),
      ]);
      await fileChooser.setFiles(imagePath);
      await page.waitForSelector('[data-testid="cropper"]', { timeout: 8_000 });
      const saveBtn = page.locator('button').filter({ hasText: /^保存$/ }).first();
      await saveBtn.click();
      await page.waitForTimeout(2_500);

      logger.info(MODULE, `  → cover image added`);
      added++;

      // Brief pause between articles
      await page.waitForTimeout(1_000);
    } catch (err) {
      logger.warn(MODULE, `  → failed: ${err.message.slice(0, 80)}`);
      failed++;
    }
  }
} finally {
  await browser.close();
}

logger.info(MODULE, `done — added:${added} skipped:${skipped} failed:${failed}`);
