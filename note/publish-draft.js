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
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser } from '../shared/browser-launch.js';
import { screenshot, uploadCoverImage, setHashtags, setPrice } from './publish-browser-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ACCOUNTS = {
  1: { session: '.note-session.json',   username: 'rascal_ai_devops', draftsDir: 'drafts' },
  2: { session: '.note-session-2.json', username: 'rascal_invest',    draftsDir: 'drafts/account2' },
  3: { session: '.note-session-3.json', username: 'rascal_affiliate', draftsDir: 'drafts/account3' },
};

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
  saveJSON(filePath, updated);
  console.log(`  updated noteUrl → ${noteUrl}`);
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

  if (imgPath && fs.existsSync(imgPath)) await page.waitForTimeout(500);

  // Step 1: 公開設定ページへ直接遷移（headless mode でクリック後ナビゲーションが発生しないため）
  const publishUrl = page.url().replace(/\/edit\/?$/, '/publish/');
  console.log(`  navigating to publish page: ${publishUrl}`);
  await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_000);
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
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node;
          let lastMatchedButtonIdx = -1;
          while ((node = walker.nextNode())) {
            if (node.textContent.includes(anchor)) {
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

  const browser = await launchBrowser({ headless: process.env.HEADED !== '1' });
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
