/**
 * note.com 既存下書き公開・記事設定更新スクリプト
 *
 * post.js で下書き保存済みだが公開に失敗した記事を公開する。
 * --update フラグで公開済み記事のハッシュタグ・価格を更新する。
 *
 * 使い方:
 *   node note/publish-draft.js --account 2
 *   node note/publish-draft.js --account 3 --noteKey n6057ecd62564
 *   node note/publish-draft.js --account 2 --update   # 公開済みの設定を更新
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ACCOUNTS = {
  1: { session: '.note-session.json',   username: 'rascal_ai_devops', draftsDir: 'drafts' },
  2: { session: '.note-session-2.json', username: 'rascal_invest',    draftsDir: 'drafts/account2' },
  3: { session: '.note-session-3.json', username: 'rascal_affiliate', draftsDir: 'drafts/account3' },
};

const SCREENSHOT_DIR = path.join(__dirname, '..', 'assets', 'note-accounts');

function parseArgs() {
  const args = process.argv.slice(2);
  let accountId = 1;
  let noteKey = null;
  let update = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--account' && args[i + 1]) accountId = Number(args[++i]);
    if (args[i] === '--noteKey' && args[i + 1]) noteKey = args[++i];
    if (args[i] === '--update') update = true;
  }
  return { accountId, noteKey, update };
}

function extractNoteKey(url) {
  // matches /n/nXXX (published) and /notes/nXXX/ (editor)
  const m = url?.match(/\/n(?:otes)?\/?([a-z0-9]{10,})/);
  return m ? m[1] : null;
}

function findDraft(draftsDir, noteKey, allowPosted = false) {
  const dir = path.join(__dirname, draftsDir);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const draft = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const key = extractNoteKey(draft.noteUrl ?? '');
      if (noteKey) {
        if (key === noteKey) return { filePath: path.join(dir, f), draft };
      } else {
        const ok = allowPosted ? draft.status === 'posted' : draft.status === 'draft';
        if (ok) return { filePath: path.join(dir, f), draft };
      }
    } catch { /* skip corrupt */ }
  }
  return null;
}

function updateDraftUrl(filePath, noteUrl) {
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = { ...draft, noteUrl };
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, filePath);
  console.log(`  updated noteUrl → ${noteUrl}`);
}

async function screenshot(page, name, accountId) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = path.join(SCREENSHOT_DIR, `publish-a${accountId}-${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  screenshot: ${p}`);
}

async function uploadCoverImage(page, imagePath, accountId) {
  if (!imagePath || !fs.existsSync(imagePath)) return;

  // Skip if cover image already set (button disappears when image exists)
  const alreadyHasCover = await page.evaluate(() => {
    const imgs = document.querySelectorAll('[class*="eyecatch"] img, [class*="headerImage"] img, [class*="HeaderImage"] img');
    return imgs.length > 0;
  });
  if (alreadyHasCover) {
    console.log('  cover image already set — skipping upload');
    return;
  }

  console.log('  uploading cover image...');

  // Approach 1: hidden file input (works when note.com exposes it directly)
  const fileInput = page.locator('input[type="file"][accept*="image"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(imagePath);
    await page.waitForTimeout(2_000);
    console.log('  cover image uploaded via hidden input');
    return;
  }

  // Approach 2: button[aria-label="画像を追加"] at top of page = header image button
  // Pick the topmost one (smallest y = above title = cover image, not in-article)
  const coverBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label="画像を追加"]'));
    if (btns.length === 0) return null;
    btns.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    btns[0].scrollIntoView({ behavior: 'instant', block: 'center' });
    const r = btns[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (coverBtn) {
    // Try direct filechooser
    try {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3_000 }),
        page.mouse.click(coverBtn.x, coverBtn.y),
      ]);
      await fc.setFiles(imagePath);
      await page.waitForTimeout(2_500);
      console.log('  cover image uploaded via top 画像を追加 button');
      return;
    } catch { /* submenu appeared — try submenu options */ }

    await page.waitForTimeout(600);
    const submenuOptions = [
      'button:has-text("画像をアップロード")',
      ':has-text("画像をアップロード")',
      'button:has-text("ローカル")',
      'button:has-text("ファイルを選択")',
    ];
    for (const ss of submenuOptions) {
      const item = page.locator(ss).first();
      if (await item.count() > 0) {
        try {
          const [fc] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 4_000 }),
            item.click(),
          ]);
          await fc.setFiles(imagePath);
          await page.waitForTimeout(2_500);
          console.log(`  cover image uploaded via submenu: ${ss}`);
          return;
        } catch { /* try next */ }
      }
    }
    await page.keyboard.press('Escape');
  }

  console.log('  ⚠ cover image upload failed — set manually in editor');
  await screenshot(page, `cover-img-fail-a${accountId}`, accountId);
}

async function setHashtags(page, tags) {
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

async function setPrice(page, price) {
  if (!price) return;
  try {
    // 記事タイプセクションを先にクリックして有料ラジオを表示させる
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

async function runPublishFlow(page, draft, username, accountId) {
  await screenshot(page, 'editor', accountId);
  const pageTitle = await page.title();
  console.log(`  page title: ${pageTitle}`);

  // 一時保存してから画像アップロード（crop確定後にサーバーリロードしても内容が消えないように）
  const saveFirst = page.locator('button:has-text("一時保存")').first();
  if (await saveFirst.count() > 0) {
    await saveFirst.click();
    await page.waitForTimeout(2_000);
    console.log('  auto-saved before image upload');
  }

  // Upload cover image while in editor (before going to publish page)
  const imgPath = draft.headerImage ?? draft.imagePath ?? null;
  await uploadCoverImage(page, imgPath, accountId);

  // Dismiss CropModal if it appeared after image upload
  const cropModal = page.locator('[class*="CropModal"], [class*="cropModal"]').first();
  if (await cropModal.count() > 0) {
    // Click 保存 in crop modal — use force:true to bypass ReactModal__Overlay interception
    const saveBtn = page.locator('.ReactModal__Content button').filter({ hasText: /保存|完了|OK|確認/ }).first();
    const lastBtn = page.locator('.ReactModal__Content button').last();
    const targetBtn = (await saveBtn.count() > 0) ? saveBtn : lastBtn;
    try {
      await targetBtn.click({ force: true, timeout: 5_000 });
      await page.waitForTimeout(2_000);
      console.log('  crop modal confirmed — reloading editor to restore content');
      // Reload the editor page so note.com re-hydrates ProseMirror from the auto-saved server state
      await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(2_000);
    } catch {
      await screenshot(page, 'crop-modal-fail', accountId);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1_000);
    }
  }

  if (imgPath && fs.existsSync(imgPath)) await page.waitForTimeout(500);

  // Step 1: 公開に進む
  const publishBtnSelectors = [
    'button:has-text("公開に進む")',
    'button:has-text("編集済みを公開")',
    'button:has-text("公開する")',
    '[data-testid="publish-button"]',
  ];
  let clicked = false;
  for (const sel of publishBtnSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.click();
      console.log(`  clicked: ${sel}`);
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    await screenshot(page, 'no-publish-btn', accountId);
    throw new Error('公開ボタンが見つかりません');
  }

  await page.waitForTimeout(3_000);
  await screenshot(page, 'publish-page', accountId);

  // Set hashtags
  const tags = draft.tags ?? draft.hashtags ?? [];
  await setHashtags(page, tags);

  // Set price (skip if IdentificationModal appears — requires manual verification)
  await setPrice(page, draft.price);
  // Check specifically for IdentificationModal (NOT ReactModal__Overlay — too broad, matches publish page itself)
  await page.waitForTimeout(500);
  const idModal = page.locator('[class*="IdentificationModal"]').first();
  if (await idModal.count() > 0) {
    console.log('  ⚠ 有料販売には身元確認が必要です — 価格設定をスキップ（手動で設定してください）');
    const closeBtn = page.locator('[class*="IdentificationModal"] button[aria-label*="閉じ"], [class*="IdentificationModal"] button:has-text("閉じる")').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // Scroll down
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, main, section'));
    const scrollable = els.filter(el => el.scrollHeight > el.clientHeight + 10)
      .sort((a, b) => b.scrollHeight - a.scrollHeight);
    if (scrollable[0]) scrollable[0].scrollTo(0, scrollable[0].scrollHeight);
    else window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(500);

  // Debug: list all buttons
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
  );
  console.log('  buttons:', buttons.slice(0, 8));

  // Step 2: 投稿する / 更新する
  const confirmSelectors = draft.price
    ? ['button:has-text("有料エリア設定")', 'button:has-text("投稿する")', 'button:has-text("更新する")', 'button:has-text("公開する")']
    : ['button:has-text("投稿する")', 'button:has-text("更新する")', 'button:has-text("公開する")', 'button:has-text("今すぐ公開")'];

  let confirmed = false;
  for (const sel of confirmSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.click();
      console.log(`  publish confirmed: ${sel}`);
      confirmed = true;
      break;
    }
  }

  if (!confirmed) {
    await screenshot(page, 'no-confirm-btn', accountId);
    console.warn('  publish confirm button not found — article may remain as draft');
    return null;
  }

  // Handle paid boundary modal
  if (draft.price && confirmed) {
    await page.waitForTimeout(2_000);
    await screenshot(page, 'paid-modal', accountId);

    const lineButtons = page.locator('button:has-text("ラインをこの場所に変更")');
    const count = await lineButtons.count();
    console.log(`  paid line buttons found: ${count}`);

    if (count > 0) {
      // freeBodyの末尾テキストを含む要素の直後のボタンを探す（段落カウント方式より正確）
      const freeBodyLines = (draft.freeBody ?? '').split('\n').map(l => l.trim()).filter(Boolean);
      const anchorText = freeBodyLines[freeBodyLines.length - 1] ?? '';
      let idx = -1;

      if (anchorText) {
        idx = await page.evaluate((anchor) => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const lineButtons = buttons.filter(b => b.textContent?.trim() === 'ラインをこの場所に変更');
          // テキストノードを全走査してanchorを含む要素を探し、その後のボタンindexを返す
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          let lastMatchedButtonIdx = -1;
          while ((node = walker.nextNode())) {
            if (node.textContent.includes(anchor)) {
              // このテキストの後に来る最初のラインボタンのindexを探す
              for (let i = 0; i < lineButtons.length; i++) {
                const pos = lineButtons[i].compareDocumentPosition(node);
                // DOCUMENT_POSITION_PRECEDING = 2: nodeがbuttonより前にある → このbuttonがanchorの後
                if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
                  lastMatchedButtonIdx = i;
                  break;
                }
              }
              break;
            }
          }
          return lastMatchedButtonIdx;
        }, anchorText);
        console.log(`  anchor "${anchorText.slice(0, 30)}..." → button idx: ${idx}`);
      }

      // anchorが見つからなければ文字数比率でフォールバック
      if (idx < 0) {
        const freeLen = (draft.freeBody ?? '').length;
        const totalLen = freeLen + (draft.paidBody ?? '').length;
        const ratio = totalLen > 0 ? freeLen / totalLen : 0.3;
        idx = Math.min(Math.floor(ratio * count), count - 1);
        console.log(`  fallback ratio ${(ratio * 100).toFixed(0)}% → button idx: ${idx}`);
      }

      await lineButtons.nth(idx).scrollIntoViewIfNeeded();
      await lineButtons.nth(idx).click();
      await page.waitForTimeout(1_000);
      console.log(`  paid line set at button ${idx + 1} of ${count}`);

      // Confirm paid publish (「投稿する」for new, 「更新する」for updates)
      const confirmPaidSelectors = ['button:has-text("投稿する")', 'button:has-text("更新する")', 'button:has-text("公開する")'];
      for (const sel of confirmPaidSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0) {
          await btn.click();
          console.log(`  paid confirm clicked: ${sel}`);
          break;
        }
      }
    } else {
      console.warn('  paid boundary modal not found — article published without paywall');
    }
  }

  await page.waitForTimeout(3_000);
  await screenshot(page, 'after-publish', accountId);

  // Get final URL
  let finalUrl = page.url();
  try {
    await page.waitForURL(/note\.com.*\/n\//, { timeout: 20_000 });
    finalUrl = page.url();
  } catch {
    const noteIdMatch = page.url().match(/\/notes\/([a-z0-9]{10,})\//);
    if (noteIdMatch) finalUrl = `https://note.com/${username}/n/${noteIdMatch[1]}`;
  }
  console.log(`  final URL: ${finalUrl}`);
  return finalUrl;
}

async function main() {
  const { accountId, noteKey, update } = parseArgs();
  const account = ACCOUNTS[accountId];
  if (!account) { console.error('Unknown account ID'); process.exit(1); }

  const sessionFile = path.join(__dirname, '..', account.session);
  if (!fs.existsSync(sessionFile)) {
    console.error(`Session file not found: ${sessionFile}`);
    console.error(`Run: node note/save-session.js ${accountId}`);
    process.exit(1);
  }

  const found = findDraft(account.draftsDir, noteKey, true);
  if (!found) {
    console.error(`No draft/article found for account ${accountId}${noteKey ? ` key=${noteKey}` : ''}`);
    process.exit(1);
  }

  const { filePath, draft } = found;
  const key = noteKey ?? extractNoteKey(draft.noteUrl ?? '');
  if (!key) { console.error('Cannot determine note key'); process.exit(1); }

  console.log(`\nAccount ${accountId} (${account.username})`);
  console.log(`Article: ${draft.title}`);
  console.log(`Tags: ${(draft.tags ?? draft.hashtags ?? []).join(', ') || 'none'}`);
  console.log(`Price: ${draft.price ?? 'free'}`);
  console.log(`Header: ${draft.headerImage ?? 'none'}`);

  const editorUrl = `https://editor.note.com/notes/${key}/edit/`;
  console.log(`Editor: ${editorUrl}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: sessionFile });
  const page = await context.newPage();

  await page.goto(editorUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(2_000);

  const noteUrl = await runPublishFlow(page, draft, account.username, accountId);

  // Only update noteUrl if it looks like a valid article URL
  const isValidArticleUrl = noteUrl && /note\.com\/[^/]+\/n\/n[a-z0-9]+/.test(noteUrl);
  if (isValidArticleUrl) {
    updateDraftUrl(filePath, noteUrl);
    console.log(`\n完了: ${noteUrl}`);
  } else if (noteUrl) {
    // Update succeeded but URL is a redirect — keep original noteKey-based URL
    const key = extractNoteKey(draft.noteUrl ?? '');
    const correctedUrl = key ? `https://note.com/${account.username}/n/${key}` : null;
    if (correctedUrl) updateDraftUrl(filePath, correctedUrl);
    console.log(`\n完了 (URL補正): ${correctedUrl ?? noteUrl}`);
  } else {
    console.log('\n失敗 — スクリーンショットを確認してください');
  }

  await browser.close();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
