/**
 * note 「編集中」記事の一括再公開
 *
 * 公開済み記事にエディタで変更を保存したが「更新する」を押さなかった場合、
 * note.com 側に未公開の差分が残る。本スクリプトがそれを検出して再公開する。
 *
 * フロー（アカウントごと）:
 *   ダッシュボード → 「編集中」バッジ付き記事を列挙
 *     ↓
 *   各記事のエディタURLを開く
 *     ↓
 *   republishNote()（公開に進む → 更新する）
 */
import 'dotenv/config';
import { launchChromeProfileContext } from '../shared/browser-launch.js';
import { NOTE_ACCOUNTS } from './accounts.js';
import { republishNote } from './post-publish.js';
import { logger } from '../shared/logger.js';
import { fileURLToPath } from 'url';

const MODULE = 'note:republish-edits';

async function findEditingArticles(page, username) {
  const dashUrl = `https://note.com/${username}`;
  await page.goto(dashUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3_000);

  // マイページの「記事を管理」へ移動
  await page.goto(`https://note.com/notes`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_000);

  // 管理ページのURLに遷移
  const mgmtUrl = `https://note.com/${username}/notes`;
  await page.goto(mgmtUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3_000);

  // 「編集中」バッジを持つ記事リンクを収集
  const editingLinks = [];

  // note.com の記事カード: data-editing, "編集中" テキスト, または badge
  const cards = await page.locator('article, [class*="NoteCard"], [class*="noteCard"], li[class*="Item"]').all();
  for (const card of cards) {
    const text = await card.textContent().catch(() => '');
    if (!text.includes('編集中')) continue;

    // エディタURLを取得（/edit へのリンク）
    const links = await card.locator('a[href*="/edit"], a[href*="editor.note"]').all();
    for (const link of links) {
      const href = await link.getAttribute('href').catch(() => null);
      if (href) editingLinks.push(href);
    }

    // リンクが見つからない場合: 記事URLから構築
    if (links.length === 0) {
      const noteLink = await card.locator('a[href*="/n/"]').first().getAttribute('href').catch(() => null);
      if (noteLink) {
        const noteId = noteLink.match(/\/n\/([a-z0-9]+)/)?.[1];
        if (noteId) editingLinks.push(`https://editor.note.com/notes/${noteId}/edit`);
      }
    }
  }

  return [...new Set(editingLinks)];
}

async function processAccount(account) {
  const { chromeProfile, noteUrl, label } = account;
  const username = noteUrl.split('/').pop();
  logger.info(MODULE, `checking ${label} (@${username})`);

  const context = await launchChromeProfileContext(chromeProfile);
  const page = await context.newPage();
  let republished = 0;

  try {
    const editingLinks = await findEditingArticles(page, username);
    logger.info(MODULE, `found ${editingLinks.length} editing articles for ${label}`);

    for (const editUrl of editingLinks) {
      try {
        const url = editUrl.startsWith('http') ? editUrl : `https://editor.note.com${editUrl}`;
        logger.info(MODULE, `opening editor: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(3_000);
        await republishNote(page);
        republished++;
        await page.waitForTimeout(2_000);
      } catch (err) {
        logger.warn(MODULE, `republish failed for ${editUrl}: ${err.message}`);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  logger.info(MODULE, `${label}: republished ${republished} articles`);
  return republished;
}

export async function runRepublishEdits() {
  let total = 0;
  for (const account of Object.values(NOTE_ACCOUNTS)) {
    try {
      total += await processAccount(account);
    } catch (err) {
      logger.error(MODULE, `account ${account.label} failed: ${err.message}`);
    }
  }
  logger.info(MODULE, `done. total republished: ${total}`);
  return total;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRepublishEdits().catch(err => {
    logger.error(MODULE, err.message);
    process.exit(1);
  });
}
