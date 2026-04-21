/**
 * note.com クロスアカウントいいね・コメントスクリプト
 *
 * 記事を投稿したアカウント以外のアカウントが、その記事にいいね＋コメントする。
 *
 * 使い方:
 *   node note/cross-engage.js --url https://note.com/rascal_invest/n/nd563d3f39dc1 --author 2
 *   node note/cross-engage.js --auto   # 全アカウントの最新公開記事を自動処理
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ACCOUNTS = {
  1: { session: '.note-session.json',   username: 'rascal_ai_devops', label: 'AI/DevOps'   },
  2: { session: '.note-session-2.json', username: 'rascal_invest',    label: '投資'        },
  3: { session: '.note-session-3.json', username: 'rascal_affiliate', label: 'アフィリ'    },
};

// カテゴリ別コメントテンプレート
const COMMENT_TEMPLATES = {
  ai: [
    'とても参考になりました！早速試してみます。',
    'わかりやすい解説ありがとうございます。実践してみます。',
    'こういう情報を探していました。フォローさせていただきます！',
    'AIツールの活用、自分も取り組んでいます。参考にします！',
  ],
  invest: [
    '投資の自動化、すごいですね。勉強になりました。',
    '税務の自動化は盲点でした。参考にさせていただきます！',
    '実践的な内容で助かります。続きも楽しみにしています。',
    'こちらのアプローチ、真似させていただきます！',
  ],
  affiliate: [
    'アフィリエイトの具体的な手順、ありがとうございます！',
    '副業初心者ですが、とても参考になりました！',
    'こういう失敗談を共有してくれると本当に助かります。',
    'ツール選びで迷っていたので助かりました！フォローします。',
  ],
};

function pickComment(url, fromAccountId) {
  let pool = COMMENT_TEMPLATES.ai;
  if (url.includes('rascal_invest') || url.includes('税務') || url.includes('invest')) {
    pool = COMMENT_TEMPLATES.invest;
  } else if (url.includes('rascal_affiliate') || url.includes('affiliate') || url.includes('失敗')) {
    pool = COMMENT_TEMPLATES.affiliate;
  }
  // fromAccountId を seed にして毎回同じにならないよう選択
  return pool[(fromAccountId + Date.now()) % pool.length];
}

function parseArgs() {
  const args = process.argv.slice(2);
  let articleUrl = null;
  let authorId = null;
  let auto = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url'    && args[i + 1]) articleUrl = args[++i];
    if (args[i] === '--author' && args[i + 1]) authorId   = Number(args[++i]);
    if (args[i] === '--auto')                  auto       = true;
  }
  return { articleUrl, authorId, auto };
}

function findLatestPosted(accountId) {
  const subdirs = { 1: 'drafts', 2: 'drafts/account2', 3: 'drafts/account3' };
  const dir = path.join(__dirname, subdirs[accountId]);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
    })
    .filter(d => d && d.status === 'posted' && d.noteUrl);

  if (files.length === 0) return null;
  return files.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
}

async function engageWithArticle(articleUrl, fromAccountId) {
  const account = ACCOUNTS[fromAccountId];
  const sessionFile = path.join(__dirname, '..', account.session);
  if (!fs.existsSync(sessionFile)) {
    console.warn(`  ⚠ account${fromAccountId}: session not found, skip`);
    return false;
  }

  console.log(`\n── account${fromAccountId} (${account.label}) がエンゲージ中 ──`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: sessionFile });
  const page    = await context.newPage();

  let success = false;
  try {
    await page.goto(articleUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2_000);

    // ── いいね ──────────────────────────────────────────────────────
    const likeSelectors = [
      'button[aria-label*="スキ"]',
      'button[aria-label*="いいね"]',
      '[data-testid="like-button"]',
      'button.o-noteContentFooter__likeButton',
      'button:has([class*="like"])',
      // ハート型ボタン
      'button svg[class*="heart"]',
    ];
    let liked = false;
    for (const sel of likeSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0) {
          const isAlreadyLiked = await btn.evaluate(el => {
            return el.getAttribute('aria-pressed') === 'true' ||
                   el.classList.toString().includes('liked') ||
                   el.classList.toString().includes('active');
          });
          if (isAlreadyLiked) {
            console.log(`  ✓ 既にスキ済み`);
            liked = true;
            break;
          }
          await btn.click();
          await page.waitForTimeout(1_500);
          console.log(`  ✓ スキした: ${sel}`);
          liked = true;
          break;
        }
      } catch { /* try next */ }
    }

    // Playwright locator でハートアイコンを探す（クラス名不問）
    if (!liked) {
      // フッターエリアのボタンを全探索
      const allBtns = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.textContent?.trim(),
          ariaLabel: b.getAttribute('aria-label'),
          classes: b.className,
        }))
      );
      console.log('  buttons found:', allBtns.map(b => b.ariaLabel || b.text).filter(Boolean).slice(0, 10));
    }

    // ── コメント ──────────────────────────────────────────────────
    const commentText = pickComment(articleUrl, fromAccountId);

    // コメント入力フィールドを探す
    const commentInputSelectors = [
      'textarea[placeholder*="コメント"]',
      'textarea[placeholder*="応援"]',
      'textarea[name*="comment"]',
      '[contenteditable][data-testid*="comment"]',
      'textarea.o-commentForm__textArea',
    ];
    let commented = false;
    for (const sel of commentInputSelectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.count() > 0) {
          await input.scrollIntoViewIfNeeded();
          await input.click();
          await input.fill(commentText);
          await page.waitForTimeout(500);

          // 送信ボタン
          const submitSelectors = [
            'button:has-text("コメントする")',
            'button:has-text("送信")',
            'button:has-text("投稿")',
            'button[type="submit"]',
          ];
          for (const ss of submitSelectors) {
            const sbtn = page.locator(ss).first();
            if (await sbtn.count() > 0) {
              await sbtn.click();
              await page.waitForTimeout(2_000);
              console.log(`  ✓ コメント投稿: "${commentText}"`);
              commented = true;
              break;
            }
          }
          break;
        }
      } catch { /* try next */ }
    }
    if (!commented) console.log('  - コメント入力フィールドが見つかりません（コメント欄が非公開の可能性）');

    success = liked || commented;
  } catch (err) {
    console.warn(`  ✗ エラー: ${err.message}`);
  } finally {
    await browser.close();
  }
  return success;
}

async function main() {
  const { articleUrl, authorId, auto } = parseArgs();

  if (auto) {
    // 全アカウントの最新記事を処理
    for (const [id] of Object.entries(ACCOUNTS)) {
      const accountId = Number(id);
      const draft = findLatestPosted(accountId);
      if (!draft) { console.log(`account${accountId}: 公開記事なし`); continue; }

      console.log(`\n=== account${accountId} の記事: ${draft.title?.slice(0, 50)} ===`);
      console.log(`URL: ${draft.noteUrl}`);

      const others = Object.keys(ACCOUNTS).map(Number).filter(n => n !== accountId);
      for (const otherId of others) {
        await engageWithArticle(draft.noteUrl, otherId);
        await new Promise(r => setTimeout(r, 3_000)); // スパム防止
      }
    }
  } else if (articleUrl && authorId) {
    // 指定記事に対して他アカウントがエンゲージ
    const others = Object.keys(ACCOUNTS).map(Number).filter(n => n !== authorId);
    console.log(`記事: ${articleUrl}`);
    console.log(`エンゲージするアカウント: ${others.map(n => `account${n}`).join(', ')}`);

    for (const otherId of others) {
      await engageWithArticle(articleUrl, otherId);
      await new Promise(r => setTimeout(r, 3_000));
    }
  } else {
    console.log('使い方:');
    console.log('  node note/cross-engage.js --url <URL> --author <accountId>');
    console.log('  node note/cross-engage.js --auto');
    process.exit(1);
  }

  console.log('\n=== クロスエンゲージ完了 ===');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
