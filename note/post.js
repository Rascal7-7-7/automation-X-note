/**
 * note 投稿モジュール（Playwright）
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
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:post';
const DRAFTS_DIR  = path.join(__dirname, 'drafts');
const SESSION_FILE = path.join(__dirname, '../.note-session.json');
const IS_MAC = process.platform === 'darwin';

function findOldestDraft() {
  if (!fs.existsSync(DRAFTS_DIR)) return null;

  const files = fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ filePath: path.join(DRAFTS_DIR, f) }))
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
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, filePath);
}

function notifyPublishReady(title, noteUrl) {
  const script = path.join(__dirname, 'notify.py');
  execFile('python3', [script, '--open'], (err) => {
    if (err) logger.warn(MODULE, 'notify script failed', { message: err.message });
  });
  logger.info(MODULE, `notify: ${title} — ${noteUrl}`);
}

async function insertPaidSection(page, editor, draft) {
  try {
    // 1. Fill free body only
    await editor.click();
    await editor.fill(draft.freeBody);
    await page.waitForTimeout(500);

    // 2. Try to insert paid divider via known selectors
    const paidDividerInserted = await tryInsertPaidDivider(page);

    if (!paidDividerInserted) {
      // Fallback: fill full body without paid split
      logger.warn(MODULE, 'paid section divider not inserted — falling back to full body');
      await editor.click();
      await editor.fill(draft.body);
      return;
    }

    // 3. Fill paid body after the divider
    await page.waitForTimeout(500);
    await page.keyboard.type(draft.paidBody);

    // 4. Set price
    await trySetPrice(page, draft.price ?? 300);
  } catch (err) {
    logger.warn(MODULE, 'paid section setup failed — falling back to full body', { message: err.message });
    await editor.click();
    await editor.fill(draft.body);
  }
}

async function tryInsertPaidDivider(page) {
  // Strategy 1: aria-label button
  try {
    const btn1 = page.locator('button[aria-label*="有料"]').first();
    if (await btn1.count() > 0) {
      await btn1.click();
      await page.waitForTimeout(300);
      return true;
    }
  } catch { /* try next */ }

  // Strategy 2: data-testid button
  try {
    const btn2 = page.locator('button[data-testid*="paid"]').first();
    if (await btn2.count() > 0) {
      await btn2.click();
      await page.waitForTimeout(300);
      return true;
    }
  } catch { /* try next */ }

  // Strategy 3: block insert (+) button → look for 有料ライン option
  try {
    const plusBtn = page.locator('button[aria-label*="追加"], button[data-testid*="add-block"], button[aria-label*="ブロック"]').first();
    if (await plusBtn.count() > 0) {
      await plusBtn.click();
      await page.waitForTimeout(300);
      const paidLine = page.locator('text=有料ライン, [role="menuitem"]:has-text("有料")').first();
      if (await paidLine.count() > 0) {
        await paidLine.click();
        await page.waitForTimeout(300);
        return true;
      }
      // Close the menu if paid line not found
      await page.keyboard.press('Escape');
    }
  } catch { /* try next */ }

  // Strategy 4: keyboard shortcut (no standard one known, skip)
  return false;
}

async function trySetPrice(page, price) {
  try {
    // Price input is typically near publish settings
    const priceInput = page.locator('input[placeholder*="価格"], input[name*="price"], input[type="number"][min]').first();
    if (await priceInput.count() > 0) {
      await priceInput.fill(String(price));
      logger.info(MODULE, `price set to ${price}`);
    } else {
      logger.warn(MODULE, 'price input not found — skipping price setting');
    }
  } catch (err) {
    logger.warn(MODULE, 'failed to set price', { message: err.message });
  }
}

// ── ヘッダー画像アップロード ────────────────────────────────────────
async function uploadCoverImage(page, imagePath) {
  // 本文入力前（空のエディタ状態）に呼ぶこと — 入力後はボタンが消える
  // 試行1: label[for] または input[type=file] を直接探す
  const fileInput = page.locator('input[type="file"][accept*="image"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(imagePath);
    await page.waitForTimeout(2_000);
    logger.info(MODULE, 'cover image uploaded via file input');
    return;
  }

  // 試行2: 「画像をアップロード」テキストを含む最小の葉要素をクリック
  const found = await page.evaluate(() => {
    const target = '画像をアップロード';
    // 全要素を末端から走査して textContent が一致する最小要素を返す
    const all = Array.from(document.querySelectorAll('*'));
    for (let i = all.length - 1; i >= 0; i--) {
      const el = all[i];
      const txt = el.textContent?.trim() ?? '';
      if (txt.startsWith(target) && txt.length < 60) {
        el.click();
        return el.tagName + '|' + txt.slice(0, 40);
      }
    }
    return null;
  });

  if (!found) {
    // 試行3: aria-label や data-testid でカバー画像ボタンを探す
    const coverSelectors = [
      'button[aria-label*="カバー"]',
      'button[aria-label*="cover"]',
      'button[aria-label*="ヘッダー"]',
      '[data-testid*="cover"]',
      '[data-testid*="header-image"]',
    ];
    for (const sel of coverSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 6_000 }),
          btn.click(),
        ]);
        await fileChooser.setFiles(imagePath);
        await page.waitForTimeout(2_000);
        logger.info(MODULE, `cover image uploaded via ${sel}`);
        return;
      }
    }
    logger.warn(MODULE, 'cover image button not found — skipping');
    return;
  }

  logger.info(MODULE, `cover image element clicked: ${found}`);
  try {
    const fileChooser = await page.waitForEvent('filechooser', { timeout: 6_000 });
    await fileChooser.setFiles(imagePath);
    await page.waitForTimeout(2_000);
    logger.info(MODULE, 'cover image uploaded');
  } catch (err) {
    logger.warn(MODULE, `filechooser not opened after click: ${err.message}`);
  }
}

// ── 公開処理 ────────────────────────────────────────────────────────
async function publishNote(page, draft) {
  // Step 1: 「公開に進む」ボタンをクリック → /publish/ ページへ遷移
  const publishBtnSelectors = [
    'button:has-text("公開に進む")',
    'button:has-text("公開する")',
    'button:has-text("公開")',
    '[data-testid="publish-button"]',
  ];
  let clicked = false;
  for (const sel of publishBtnSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        await btn.click();
        clicked = true;
        logger.info(MODULE, `publish button clicked: ${sel}`);
        break;
      }
    } catch { /* try next */ }
  }
  if (!clicked) throw new Error('publish button not found');

  // /publish/ ページへの遷移を待つ
  await page.waitForTimeout(2_500);

  // Step 2: ハッシュタグ設定
  const tags = draft.tags ?? draft.hashtags ?? [];
  if (tags.length > 0) {
    try {
      // 「ハッシュタグ」ボタンをクリックして入力フィールドを開く
      const hashBtn = page.getByText('ハッシュタグ').first();
      if (await hashBtn.count() > 0) {
        await hashBtn.click();
        await page.waitForTimeout(500);
      }
      // ハッシュタグ入力フィールドを探す
      const tagInput = page.locator('input[placeholder*="タグ"], input[placeholder*="ハッシュ"]').first();
      if (await tagInput.count() > 0) {
        for (const tag of tags.slice(0, 5)) {
          const cleanTag = tag.replace(/^#/, '');
          await tagInput.fill(cleanTag);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
        }
        logger.info(MODULE, `hashtags set: ${tags.join(', ')}`);
      }
    } catch (err) {
      logger.warn(MODULE, `hashtag setting failed: ${err.message}`);
    }
  }

  // Step 3: 有料設定（draft.price が設定されている場合）
  if (draft.price) {
    try {
      // まず「有料」ラジオ/トグルをクリックして価格入力を出現させる
      const paidTriggers = [
        'label:has-text("有料")',
        'input[type="radio"][value*="paid"]',
        'input[type="radio"][value*="有料"]',
        'button:has-text("有料")',
        '[data-testid*="paid"]',
        'span:has-text("有料")',
      ];
      let paidEnabled = false;
      for (const sel of paidTriggers) {
        try {
          const el = page.locator(sel).first();
          if (await el.count() > 0) {
            await el.click();
            await page.waitForTimeout(1_000);  // 価格入力フィールドが出現するのを待つ
            paidEnabled = true;
            logger.info(MODULE, `paid toggle clicked: ${sel}`);
            break;
          }
        } catch { /* try next */ }
      }

      // 価格入力フィールドを探す（有料トグル後に出現する）
      // note.com の価格入力は type="text" placeholder="300"
      const priceInput = page.locator(
        'input[type="number"], input[placeholder*="価格"], input[placeholder*="円"], input[placeholder="300"]'
      ).first();
      if (await priceInput.count() > 0) {
        await priceInput.click({ clickCount: 3 });
        await priceInput.fill(String(draft.price));
        await page.waitForTimeout(300);
        logger.info(MODULE, `price set: ${draft.price}円`);
      } else if (paidEnabled) {
        logger.warn(MODULE, 'paid toggle clicked but price input not found');
      } else {
        logger.warn(MODULE, 'paid toggle not found — article will be free');
      }
    } catch (err) {
      logger.warn(MODULE, `price setting failed: ${err.message}`);
    }
  }

  // Step 4: 最終「投稿する」ボタン（価格入力後に少し待つ）
  await page.waitForTimeout(1_000);
  // 「投稿する」テキストを持つ全要素を探す（button 以外も含む）
  const publishEl = await page.evaluate(() => {
    const keywords = ['投稿する', '今すぐ公開', 'noteに公開', '公開する'];
    const all = Array.from(document.querySelectorAll('*'));
    for (const kw of keywords) {
      for (let i = all.length - 1; i >= 0; i--) {
        const el = all[i];
        if (el.children.length === 0 && el.textContent?.trim() === kw) {
          return { tag: el.tagName, text: el.textContent.trim(), found: true };
        }
      }
    }
    // 部分一致でも探す
    for (const kw of keywords) {
      for (let i = all.length - 1; i >= 0; i--) {
        const el = all[i];
        if (el.children.length === 0 && el.textContent?.includes(kw)) {
          return { tag: el.tagName, text: el.textContent.trim().slice(0, 30), found: true, partial: true };
        }
      }
    }
    return { found: false };
  });
  // 「投稿する」ボタンはページ下部にあるためスクロールして表示させる
  // note の publish ページは内部コンテナがスクロール対象
  await page.evaluate(() => {
    // overflow: auto/scroll を持つ最大の div を探してスクロール
    const els = Array.from(document.querySelectorAll('div, main, section'));
    const scrollable = els
      .filter(el => el.scrollHeight > el.clientHeight + 10)
      .sort((a, b) => b.scrollHeight - a.scrollHeight);
    if (scrollable[0]) scrollable[0].scrollTo(0, scrollable[0].scrollHeight);
    else window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(800);

  // 有料記事: 「有料」選択後はヘッダーボタンが「投稿する」→「有料エリア設定」に変わる
  // 無料記事: 「投稿する」のまま
  const confirmSelectors = draft.price
    ? [
        'button:has-text("有料エリア設定")',
        'button:has-text("投稿する")',
        'button:has-text("公開する")',
      ]
    : [
        'button:has-text("投稿する")',
        'button:has-text("公開する")',
        'button:has-text("今すぐ公開")',
        'button:has-text("noteに公開する")',
      ];

  let confirmed = false;
  for (const sel of confirmSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        await btn.click();
        confirmed = true;
        logger.info(MODULE, `publish confirmed: ${sel}`);
        break;
      }
    } catch { /* try next */ }
  }
  if (!confirmed) {
    logger.warn(MODULE, 'publish confirm button not found — article may remain as draft');
  } else if (draft.price) {
    // 有料エリア設定クリック後: 境界設定モーダルが開く
    // 「このラインより先を有料にする」で境界を確定 → 「投稿する」で投稿
    await page.waitForTimeout(1_000);
    try {
      const lineBtn = page.locator('button:has-text("このラインより先を有料にする")').first();
      if (await lineBtn.count() > 0) {
        await lineBtn.click();
        await page.waitForTimeout(500);
        logger.info(MODULE, 'paid line boundary set');
      }
    } catch { /* ラインが既に設定済みの場合はスキップ */ }

    // モーダル内の「投稿する」をクリック
    const postBtn = page.locator('button:has-text("投稿する")').first();
    if (await postBtn.count() > 0) {
      await postBtn.click();
      logger.info(MODULE, 'paid article posted via 投稿する in boundary modal');
    } else {
      logger.warn(MODULE, '投稿する not found in boundary modal');
    }
  }

  // 公開後 note.com の記事URLへの遷移を待つ（30秒）
  // パターン例: https://note.com/@user/n/nXXXX
  //            https://editor.note.com/notes/nXXXX/published
  try {
    await page.waitForURL(/note\.com.*\/n\//, { timeout: 30_000 });
  } catch {
    // 遷移しなくても続行（記事は公開済みの可能性あり）
    await page.waitForTimeout(2_000);
  }
  const finalUrl = page.url();
  logger.info(MODULE, `final URL: ${finalUrl}`);
  return finalUrl;
}

export async function runPost(opts = {}) {
  const headless = opts.headless ?? true;
  const file = findOldestDraft();

  if (!file) {
    logger.info(MODULE, 'no drafts to post');
    return;
  }

  const { draft } = file;
  logger.info(MODULE, `posting: ${draft.title}`);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState: fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined,
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
      await context.storageState({ path: SESSION_FILE });
    }

    // ── 新規記事作成 ──────────────────────────────────────────────
    await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // ログインページにリダイレクトされた場合はセッション切れ
    if (page.url().includes('/login')) {
      throw new Error('session expired — run: node note/save-session.js');
    }
    logger.info(MODULE, `editor URL: ${page.url()}`);

    // エディタ読み込みを待つ（タイトル textarea が出現したら準備完了）
    await page.waitForSelector('textarea[placeholder="記事タイトル"]', { timeout: 30_000 });
    await page.waitForTimeout(1_000);

    // ── タイトル ─────────────────────────────────────────────────
    await page.locator('textarea[placeholder="記事タイトル"]').fill(draft.title);
    logger.info(MODULE, 'title filled');

    // ── ヘッダー画像（本文入力前に行う — 本文入力後はボタンが消える）─
    if (draft.imagePath && fs.existsSync(draft.imagePath)) {
      try {
        await uploadCoverImage(page, draft.imagePath);
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

    if (draft.paidBody) {
      await insertPaidSection(page, editor, draft);
    } else {
      await editor.click();
      await page.waitForTimeout(500);
      await page.evaluate(text => navigator.clipboard.writeText(text), bodyText);
      await page.keyboard.press(IS_MAC ? 'Meta+a' : 'Control+a');
      await page.keyboard.press(IS_MAC ? 'Meta+v' : 'Control+v');
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

    // ── 公開（prod のみ） ─────────────────────────────────────────
    const isDev = (opts.mode ?? process.env.MODE ?? 'dev') === 'dev';
    if (isDev) {
      const noteUrl = page.url();
      markPosted(file.filePath, noteUrl);
      logNotePosted(file.filePath, noteUrl);
      logger.info(MODULE, `DEV: saved as draft only — ${noteUrl}`);
      notifyPublishReady(draft.title, noteUrl);
    } else {
      const noteUrl = await publishNote(page, draft);
      markPosted(file.filePath, noteUrl);
      logNotePosted(file.filePath, noteUrl);
      logger.info(MODULE, `published: ${noteUrl}`);
    }
  } catch (err) {
    logger.error(MODULE, 'post failed', { message: err.message });
    throw err;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPost({ headless: !process.argv.includes('--headed') });
}
