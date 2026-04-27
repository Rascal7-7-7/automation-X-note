/**
 * YouTube コミュニティ投稿 — Playwright 自動投稿
 *
 * フロー:
 *   1. .youtube-session.json を読み込み
 *   2. YouTube Studio → コミュニティタブへ遷移
 *   3. テキスト入力 → 投稿
 *   4. community-posts.jsonl の対象エントリを posted に更新
 *
 * 前提: node youtube/save-session.js でセッション作成済み
 */
import { launchBrowser } from '../shared/browser-launch.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE   = path.join(__dirname, '..', '.youtube-session.json');
const POSTS_LOG      = path.join(__dirname, 'queue', 'community-posts.jsonl');
const COMMUNITY_URL  = 'https://www.youtube.com/post';
const MODULE         = 'youtube:post-community';

// ── キュー操作 ──────────────────────────────────────────────────────

function loadPendingPost() {
  if (!fs.existsSync(POSTS_LOG)) return null;
  const lines = fs.readFileSync(POSTS_LOG, 'utf8')
    .split('\n').filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.status === 'pending') return { entry, index: i, lines };
    } catch { continue; }
  }
  return null;
}

function markPosted(lines, index) {
  const updated = [...lines];
  const entry   = JSON.parse(updated[index]);
  updated[index] = JSON.stringify({ ...entry, status: 'posted', postedAt: new Date().toISOString() });
  fs.writeFileSync(POSTS_LOG, updated.join('\n') + '\n');
}

// ── Playwright 投稿 ──────────────────────────────────────────────────

async function postCommunityUpdate(text) {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error('セッションファイルがありません。先に: node youtube/save-session.js');
  }

  const browser = await launchBrowser({
    headless: true,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    // YouTube Studio コミュニティタブ
    await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // セッション切れ検出
    const url = page.url();
    if (url.includes('accounts.google.com')) {
      throw new Error('セッション切れ。node youtube/save-session.js で再作成してください。');
    }

    // コミュニティ投稿ボタンへ遷移
    await page.goto('https://studio.youtube.com/channel/community', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // 投稿テキストエリア
    const textArea = page.locator('[contenteditable="true"]').first();
    await textArea.waitFor({ state: 'visible', timeout: 15_000 });
    await textArea.click();
    await textArea.fill(text);
    await page.waitForTimeout(1000);

    // 投稿ボタン
    const postBtn = page.getByRole('button', { name: /投稿|Post/i }).last();
    await postBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await postBtn.click();

    // 投稿完了確認
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    logger.info(MODULE, 'posted successfully', { url: currentUrl });

    return true;
  } finally {
    await browser.close();
  }
}

// ── 公開 API ────────────────────────────────────────────────────────

export async function runPostCommunity() {
  const found = loadPendingPost();
  if (!found) {
    logger.info(MODULE, 'no pending community posts');
    return;
  }

  const { entry, index, lines } = found;
  logger.info(MODULE, 'posting community update', { type: entry.type, chars: entry.text.length });

  await postCommunityUpdate(entry.text);
  markPosted(lines, index);
  logger.info(MODULE, 'community post done', { type: entry.type });

  return { type: entry.type, text: entry.text };
}

// ── CLI ─────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPostCommunity().catch(err => {
    logger.error(MODULE, 'community post failed', { message: err.message });
    process.exit(1);
  });
}
