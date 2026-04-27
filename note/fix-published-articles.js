/**
 * 投稿済み記事の一括修正スクリプト
 * - 有料設定なし → ¥500に変更
 * - 無料公開なのに「続きは有料部分で解説します↓」残存 → 削除して再公開
 *
 * Usage: node note/fix-published-articles.js [--dry-run] [--headless=false]
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import { logger } from '../shared/logger.js';
import fs from 'fs';
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:fix';
const MISLEADING = '続きは有料部分で解説します';

const DRY_RUN  = process.argv.includes('--dry-run');
const HEADLESS = !process.argv.includes('--headless=false');

const ACCOUNT_META = {
  1: { username: 'rascal_ai_devops', session: '.note-session.json' },
  2: { username: 'rascal_invest',    session: '.note-session-2.json' },
  3: { username: 'rascal_affiliate', session: '.note-session-3.json' },
};

const DRAFTS_DIRS = [
  { dir: path.join(__dirname, 'drafts'),          accountId: 1 },
  { dir: path.join(__dirname, 'drafts/account2'), accountId: 2 },
  { dir: path.join(__dirname, 'drafts/account3'), accountId: 3 },
];

// ── ドラフト読み込み ──────────────────────────────────────────────

function loadAllPosted() {
  const items = [];
  for (const { dir, accountId } of DRAFTS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      try {
        const filePath = path.join(dir, f);
        const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (draft.status === 'posted' && draft.noteUrl) {
          items.push({ draft: { ...draft, accountId: draft.accountId ?? accountId }, filePath });
        }
      } catch { /* skip */ }
    }
  }
  return items;
}

function needsTextFix(draft) {
  return (draft.freeBody ?? '').includes(MISLEADING);
}

function cleanBody(draft) {
  const cleanFree = (draft.freeBody ?? '').replace(new RegExp(`[\\n\\r]*${MISLEADING}[^\n]*`, 'g'), '').trimEnd();
  return cleanFree + '\n\n' + (draft.paidBody ?? '');
}

function noteIdFromUrl(url) {
  const m = url.match(/\/n\/(n[a-z0-9]+)/);
  return m?.[1] ?? null;
}

// ── note.com 操作 ─────────────────────────────────────────────────

async function waitForEditor(page) {
  await page.waitForSelector('[contenteditable="true"]', { timeout: 20_000 });
  return page.locator('[contenteditable="true"]').first();
}

async function navigateToEdit(page, noteUrl) {
  const noteId = noteIdFromUrl(noteUrl);
  if (!noteId) throw new Error(`cannot extract noteId from ${noteUrl}`);

  // Correct editor URL: note.com/notes/{id}/edit → redirects to editor.note.com/notes/{id}/edit/
  const editUrl = `https://note.com/notes/${noteId}/edit`;
  await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await page.waitForTimeout(3_000);
  logger.info(MODULE, `edit url: ${page.url()}`);
  return noteId;
}

async function fillEditor(page, body) {
  const editor = await waitForEditor(page);
  await editor.click();
  // Select all existing content and replace
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(300);
  await editor.fill(body);
  await page.waitForTimeout(1_000);
  logger.info(MODULE, 'editor filled');
}

async function openPublishPanel(page) {
  const selectors = ['button:has-text("公開に進む")', 'button:has-text("公開する")', 'button:has-text("公開")'];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(2_500);
      logger.info(MODULE, `publish panel opened via: ${sel}`);
      return true;
    }
  }
  return false;
}

async function setPaidPrice(page, price, draft) {
  // Re-expand 記事タイプ accordion (collapses after ハッシュタグ interaction)
  const articleTypeBtn = page.getByText('記事タイプ').first();
  if (await articleTypeBtn.count() > 0) {
    await articleTypeBtn.click();
    await page.waitForTimeout(800);
  }

  await page.waitForSelector('label:has-text("有料")', { timeout: 8_000 }).catch(() => {});

  const paidTriggers = [
    'label:has-text("有料")',
    'input[type="radio"][value*="paid"]',
    'button:has-text("有料")',
    'span:has-text("有料")',
  ];

  for (const sel of paidTriggers) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.click({ force: true });
      await page.waitForTimeout(1_000);

      // Check for 身元確認 modal
      const idModal = page.locator('[class*="IdentificationModal"], [class*="ReactModal__Overlay"]').first();
      if (await idModal.count() > 0) {
        logger.warn(MODULE, '身元確認モーダル — 有料設定スキップ（acct3: 手動で設定要）');
        const closeBtn = idModal.locator('button:has-text("閉じる"), button:has-text("キャンセル"), [aria-label="閉じる"]').first();
        if (await closeBtn.count() > 0) await closeBtn.click();
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(1_000);
        // Re-open panel if it closed
        if (await page.locator('button:has-text("投稿する")').count() === 0) {
          await openPublishPanel(page);
        }
        return false; // paid not set
      }

      logger.info(MODULE, `paid toggle clicked: ${sel}`);
      break;
    }
  }

  // Set price
  const priceInput = page.locator(
    'input[type="number"], input[placeholder*="価格"], input[placeholder*="円"], input[placeholder="300"]'
  ).first();
  if (await priceInput.count() > 0) {
    await priceInput.click({ clickCount: 3 });
    await priceInput.fill(String(price));
    await page.waitForTimeout(300);
    logger.info(MODULE, `price set: ¥${price}`);
    return true;
  }

  logger.warn(MODULE, 'price input not found');
  return false;
}

async function confirmPublish(page, paidWasSet, draft) {
  await page.waitForTimeout(1_000);

  // Scroll to bottom to reveal buttons
  await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div')).filter(el => el.scrollHeight > el.clientHeight + 10);
    divs.sort((a, b) => b.scrollHeight - a.scrollHeight);
    if (divs[0]) divs[0].scrollTo(0, divs[0].scrollHeight);
    else window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(800);

  // Log all visible buttons for diagnosis
  const visibleBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
  );
  logger.info(MODULE, `publish panel buttons: ${visibleBtns.join(' | ')}`);

  const confirmSelectors = paidWasSet
    ? ['button:has-text("有料エリア設定")', 'button:has-text("投稿する")', 'button:has-text("公開する")']
    : ['button:has-text("投稿する")', 'button:has-text("公開する")', 'button:has-text("今すぐ公開")'];

  for (const sel of confirmSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.click();
      logger.info(MODULE, `confirm clicked: ${sel}`);

      if (paidWasSet && sel.includes('有料エリア設定')) {
        // Wait for paid boundary modal to appear
        await page.waitForTimeout(2_500);

        // Log all buttons to debug what's in the boundary modal
        const modalBtns = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean)
        );
        logger.info(MODULE, `boundary modal buttons: ${modalBtns.join(' | ')}`);

        // Try multiple selectors for the boundary line buttons
        const lineSelectors = [
          'button:has-text("ラインをこの場所に変更")',
          'button:has-text("ここで区切る")',
          'button:has-text("有料ラインをここに")',
          '[class*="paidLine"] button',
          '[class*="boundary"] button',
        ];
        let lineClicked = false;
        for (const lineSel of lineSelectors) {
          const lineButtons = page.locator(lineSel);
          const count = await lineButtons.count();
          if (count > 0) {
            const freeParagraphs = (draft.freeBody ?? '').split('\n\n').filter(p => p.trim()).length;
            const idx = Math.min(Math.max(freeParagraphs - 1, 0), count - 1);
            await lineButtons.nth(idx).click();
            await page.waitForTimeout(800);
            lineClicked = true;
            logger.info(MODULE, `boundary line set: ${lineSel} idx=${idx}/${count}`);
            break;
          }
        }

        if (!lineClicked) {
          logger.warn(MODULE, 'no boundary line buttons found — trying to post without boundary');
        }

        // Click the confirm button inside the boundary modal
        // Existing articles: "更新する" | New articles: "投稿する"
        const confirmBtnSel = 'button:has-text("更新する"), button:has-text("投稿する"), button:has-text("公開する")';
        const postBtn = page.locator(confirmBtnSel).first();
        if (await postBtn.count() > 0) {
          const btnText = await postBtn.textContent();
          await postBtn.click();
          logger.info(MODULE, `boundary modal confirm clicked: ${btnText?.trim()}`);
          try {
            await page.waitForURL(/note\.com.*\/n\//, { timeout: 15_000 });
          } catch { /* redirect may not happen for update */ }
        } else {
          logger.warn(MODULE, 'boundary confirm button not found');
        }
      }
      return true;
    }
  }

  logger.warn(MODULE, 'confirm button not found');
  return false;
}

// ── メイン ────────────────────────────────────────────────────────

async function fixArticle(page, item) {
  const { draft, filePath } = item;
  const { noteUrl, title, price, accountId } = draft;

  logger.info(MODULE, `\n--- fixing: ${title}`);
  logger.info(MODULE, `  url: ${noteUrl}`);

  const needsText = needsTextFix(draft);
  logger.info(MODULE, `  needs text fix: ${needsText}, needs paid: ${Boolean(price)}`);

  if (DRY_RUN) {
    logger.info(MODULE, '  [dry-run] skipping actual changes');
    return;
  }

  try {
    await navigateToEdit(page, noteUrl);

    if (needsText) {
      const body = cleanBody(draft);
      await fillEditor(page, body);
    }

    const opened = await openPublishPanel(page);
    if (!opened) {
      logger.warn(MODULE, 'could not open publish panel');
      return;
    }

    let paidWasSet = false;
    if (price) {
      paidWasSet = await setPaidPrice(page, price, draft);
    }

    await confirmPublish(page, paidWasSet, draft);
    await page.waitForTimeout(3_000);

    // Verify URL changed to note page
    const finalUrl = page.url();
    logger.info(MODULE, `  done. url: ${finalUrl}`);

    // Update local draft to reflect the paid status attempt
    if (paidWasSet || needsText) {
      const updated = { ...draft };
      if (needsText) {
        updated.freeBody = (draft.freeBody ?? '').replace(
          new RegExp(`[\\n\\r]*${MISLEADING}[^\n]*`, 'g'), ''
        ).trimEnd();
        updated.body = cleanBody(draft);
      }
      if (paidWasSet) updated.paidSetAt = new Date().toISOString();
      updated.fixedAt = new Date().toISOString();
      saveJSON(filePath, updated);
      logger.info(MODULE, '  local draft updated');
    }
  } catch (err) {
    logger.error(MODULE, `fix failed for ${title}: ${err.message}`);
  }
}

async function main() {
  const allItems = loadAllPosted();

  // Filter to only articles that need fixing
  const toFix = allItems.filter(({ draft }) => {
    const textIssue = needsTextFix(draft);
    const paidIssue = Boolean(draft.price); // We'll let the script attempt paid; it'll skip if already set
    return textIssue || paidIssue;
  });

  // Articles confirmed needing fix from audit (explicit list to avoid re-processing OK articles)
  const NEED_FIX_URLS = new Set([
    'https://note.com/rascal_ai_devops/n/nd15b3ad263b3', // AI執筆ツール (paid only)
    'https://note.com/rascal_ai_devops/n/n187baed94d4f', // AIツール3つ (paid + text)
    'https://note.com/rascal_ai_devops/n/n13dda47d1ecf', // ChatGPT×note (paid + text)
    'https://note.com/rascal_ai_devops/n/n76316ffc87a3', // X×note (paid + text)
    'https://note.com/rascal_ai_devops/n/n1ef15b5d8772', // Claude×n8n (paid + text)
    'https://note.com/rascal_invest/n/nd563d3f39dc1',    // AI副業の税務 (paid + text)
    'https://note.com/rascal_affiliate/n/n6057ecd62564', // AIツール選び (paid + text)
    'https://note.com/rascal_affiliate/n/n2d36f02bbeae', // note初収益 (paid + text)
  ]);

  const fixItems = allItems.filter(({ draft }) => NEED_FIX_URLS.has(draft.noteUrl));
  console.log(`\n修正対象: ${fixItems.length}件`);
  if (DRY_RUN) console.log('[dry-run モード — 実際の変更なし]\n');

  // Group by account to avoid re-logging in
  const byAccount = {};
  for (const item of fixItems) {
    const id = item.draft.accountId;
    if (!byAccount[id]) byAccount[id] = [];
    byAccount[id].push(item);
  }

  for (const [accountId, items] of Object.entries(byAccount)) {
    const meta = ACCOUNT_META[accountId];
    if (!meta) continue;

    const sessionFile = path.join(__dirname, '..', meta.session);
    logger.info(MODULE, `\n=== account ${accountId} (${meta.username}) — ${items.length}件 ===`);

    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
      storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Verify logged in
    await page.goto('https://note.com/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(2_000);
    if (page.url().includes('/login')) {
      logger.error(MODULE, `not logged in for account ${accountId} — load session first`);
      await browser.close();
      continue;
    }

    for (const item of items) {
      await fixArticle(page, item);
      await page.waitForTimeout(2_000); // rate limit between articles
    }

    await browser.close();
    logger.info(MODULE, `account ${accountId} done`);
  }

  console.log('\n=== 完了 ===');
}

main().catch(e => { console.error(e); process.exit(1); });
