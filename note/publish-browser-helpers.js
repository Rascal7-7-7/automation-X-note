/**
 * note 公開フロー — Playwright ブラウザUI操作ヘルパー
 * カバー画像アップロード、ハッシュタグ、価格設定、スクリーンショット。
 * publish-draft.js の runPublishFlow から使用する。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'assets', 'note-accounts');

export async function screenshot(page, name, accountId) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = path.join(SCREENSHOT_DIR, `publish-a${accountId}-${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  screenshot: ${p}`);
}

async function dismissCropModal(page, accountId) {
  await page.waitForTimeout(1_000);
  const cropModal = page.locator('[class*="CropModal"], [class*="cropModal"]').first();
  if (await cropModal.count() === 0) return;
  const saveBtn = page.locator('.ReactModal__Content button').filter({ hasText: /保存|完了|OK|確認/ }).first();
  const lastBtn = page.locator('.ReactModal__Content button').last();
  const btn = (await saveBtn.count() > 0) ? saveBtn : lastBtn;
  try {
    await btn.click({ force: true, timeout: 5_000 });
    await page.waitForTimeout(2_000);
    console.log('  crop modal confirmed — reloading editor');
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2_000);
  } catch {
    await screenshot(page, 'crop-modal-fail', accountId);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1_000);
  }
}

async function uploadOrReplaceCover(page, imagePath, accountId) {
  async function doUpload(triggerFn) {
    try {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 4_000 }),
        triggerFn(),
      ]);
      await fc.setFiles(imagePath);
      await page.waitForTimeout(2_500);
      await dismissCropModal(page, accountId);
      return true;
    } catch { return false; }
  }

  async function trySubmenu() {
    await page.waitForTimeout(600);
    for (const sel of ['button:has-text("画像をアップロード")', 'button:has-text("ローカル")', 'button:has-text("ファイルを選択")']) {
      const item = page.locator(sel).first();
      if (await item.count() > 0) {
        const ok = await doUpload(() => item.click());
        if (ok) { console.log(`  uploaded via submenu: ${sel}`); return true; }
      }
    }
    await page.keyboard.press('Escape');
    return false;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const coverCoords = await page.evaluate(() => {
    const img = Array.from(document.querySelectorAll('img')).find(el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < 500 && r.width > 150 && r.height > 50;
    });
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (coverCoords) {
    console.log('  cover exists — replacing...');
    await page.mouse.move(coverCoords.x, coverCoords.y);
    await page.waitForTimeout(800);

    for (const sel of ['button:has-text("変更")', 'button:has-text("画像を変更")', '[aria-label*="変更"]']) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        const ok = await doUpload(() => btn.click());
        if (ok) { console.log('  cover replaced via 変更 button'); return; }
        if (await trySubmenu()) return;
      }
    }

    const delBtn = page.locator('[aria-label="削除"], button:has-text("×"), button:has-text("✕")').first();
    if (await delBtn.count() > 0) {
      await delBtn.scrollIntoViewIfNeeded();
      await delBtn.click({ force: true });
      await page.waitForTimeout(1_000);
      console.log('  existing cover deleted — re-uploading');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
    } else {
      console.log('  ⚠ replace failed — could not find 変更/削除 button');
      await screenshot(page, `cover-img-fail-a${accountId}`, accountId);
      return;
    }
  }

  console.log('  uploading fresh cover...');

  const fileInput = page.locator('input[type="file"][accept*="image"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(imagePath);
    await page.waitForTimeout(2_000);
    await dismissCropModal(page, accountId);
    console.log('  cover uploaded via hidden input');
    return;
  }

  const coverBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label="画像を追加"]'));
    if (!btns.length) return null;
    btns.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    btns[0].scrollIntoView({ behavior: 'instant', block: 'center' });
    const r = btns[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (coverBtn) {
    const ok = await doUpload(() => page.mouse.click(coverBtn.x, coverBtn.y));
    if (ok) { console.log('  cover uploaded via 画像を追加 button'); return; }
    if (await trySubmenu()) return;
  }

  console.log('  ⚠ cover image upload failed — set manually in editor');
  await screenshot(page, `cover-img-fail-a${accountId}`, accountId);
}

export async function uploadCoverImage(page, imagePath, accountId) {
  if (!imagePath || !fs.existsSync(imagePath)) return;
  await uploadOrReplaceCover(page, imagePath, accountId);
}

export async function setHashtags(page, tags) {
  if (!tags || tags.length === 0) return;
  try {
    const hashBtn = page.getByText('ハッシュタグ').first();
    if (await hashBtn.count() > 0) {
      await hashBtn.click();
      await page.waitForTimeout(500);
    }
    const tagInput = page.locator('input[placeholder*="タグ"], input[placeholder*="ハッシュ"]').first();
    if (await tagInput.count() > 0) {
      for (const tag of tags.slice(0, 5)) {
        await tagInput.fill(tag.replace(/^#/, ''));
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
      }
      console.log(`  hashtags set: ${tags.join(', ')}`);
    } else {
      console.log('  hashtag input not found');
    }
  } catch (err) {
    console.log(`  hashtag setting failed: ${err.message}`);
  }
}

export async function setPrice(page, price) {
  if (!price) return;
  try {
    const articleTypeSection = page.getByText('記事タイプ').first();
    if (await articleTypeSection.count() > 0) {
      await articleTypeSection.click();
      await page.waitForTimeout(600);
    }

    const paidTriggers = [
      'label:has-text("有料")',
      'input[type="radio"][value*="paid"]',
      'button:has-text("有料")',
      'span:has-text("有料")',
    ];
    let enabled = false;
    for (const sel of paidTriggers) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click({ timeout: 5_000 }).catch(() => el.evaluate(e => e.click()));
        await page.waitForTimeout(1_000);
        enabled = true;
        console.log(`  paid toggle clicked: ${sel}`);
        break;
      }
    }
    const priceInput = page.locator(
      'input[type="number"], input[placeholder*="価格"], input[placeholder*="円"], input[placeholder="300"]'
    ).first();
    if (await priceInput.count() > 0) {
      await priceInput.click({ clickCount: 3 });
      await priceInput.fill(String(price));
      await page.waitForTimeout(300);
      console.log(`  price set: ${price}円`);
    } else if (enabled) {
      console.log('  paid toggle clicked but price input not found');
    } else {
      console.log('  paid toggle not found — article will be free');
    }
  } catch (err) {
    console.log(`  price setting failed: ${err.message}`);
  }
}
