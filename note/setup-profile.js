/**
 * note.com プロフィール設定スクリプト
 * アイコン・ヘッダー画像・表示名・自己紹介文を自動設定
 *
 * 使い方:
 *   node note/setup-profile.js 2   # アカウント2
 *   node note/setup-profile.js 3   # アカウント3
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNT_ID = Number(process.env.NOTE_ACCOUNT ?? process.argv[2] ?? 2);

const SESSION_FILES = {
  1: '.note-session.json',
  2: '.note-session-2.json',
  3: '.note-session-3.json',
};

const ASSETS = path.join(__dirname, '../assets/note-accounts');

const PROFILES = {
  2: {
    displayName: 'エンジニアの投資実験室｜Rascal',
    bio: 'エンジニアが本業の傍らFX・株・NISA・仮想通貨を自動化で運用。勝ち負けも含めてリアルな数字を公開中。AIで資産形成を加速する方法を発信。',
    // キャラ版が存在すればそちらを優先、なければ汎用版
    iconPath:   resolveIcon(2),
    headerPath: path.join(ASSETS, 'account2-header.png'),
  },
  3: {
    displayName: 'アフィリエイト実験室｜Rascal',
    bio: 'A8.netで月5万円を目指すブログ×AI自動化の記録。SEO・コンテンツ設計・ASP案件選定まで全部公開。ゼロから始めた人向けに実践データを発信中。',
    iconPath:   resolveIcon(3),
    headerPath: path.join(ASSETS, 'account3-header.png'),
  },
};

function resolveIcon(accountId) {
  const charIcon = path.join(ASSETS, `account${accountId}-icon-char.png`);
  const defaultIcon = path.join(ASSETS, `account${accountId}-icon.png`);
  return fs.existsSync(charIcon) ? charIcon : defaultIcon;
}

async function uploadImage(page, inputLocator, imgPath) {
  // file inputが非表示の場合もsetInputFilesは動作する
  await inputLocator.setInputFiles(imgPath);
  // アップロード完了まで待機（プレビュー更新を待つ）
  await page.waitForTimeout(3000);
}

async function main() {
  const profile = PROFILES[ACCOUNT_ID];
  if (!profile) {
    console.error(`未定義アカウント: ${ACCOUNT_ID}`);
    process.exit(1);
  }

  const sessionFile = path.join(__dirname, '..', SESSION_FILES[ACCOUNT_ID]);
  if (!fs.existsSync(sessionFile)) {
    console.error(`セッションファイルなし: ${sessionFile}`);
    console.error(`先に: node note/save-session.js ${ACCOUNT_ID}`);
    process.exit(1);
  }

  console.log(`\n=== アカウント${ACCOUNT_ID} プロフィール設定 ===`);
  console.log(`  アイコン  : ${path.basename(profile.iconPath)}`);
  console.log(`  ヘッダー  : ${path.basename(profile.headerPath)}`);
  console.log(`  表示名    : ${profile.displayName}`);

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({ storageState: sessionFile });
  const page    = await context.newPage();

  try {
    await page.goto('https://note.com/settings/profile', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // スクリーンショットで現状確認
    await page.screenshot({ path: path.join(ASSETS, `debug-profile-a${ACCOUNT_ID}-before.png`) });
    console.log('\nページ読み込み完了');

    // ── トリミングモーダル確認ヘルパー ────────────────────────────
    async function confirmCropModal() {
      const confirmBtn = page.locator('button:has-text("この画像を使う")');
      if (await confirmBtn.count() > 0) {
        await confirmBtn.click();
        await page.waitForTimeout(2000);
        await page.waitForSelector('[data-name="modal"]', { state: 'hidden', timeout: 10000 }).catch(() => {});
      }
    }

    // ── ヘッダー（input#headerImage に直接setInputFiles） ────────
    if (fs.existsSync(profile.headerPath)) {
      console.log('ヘッダーをアップロード中...');
      const headerInput = page.locator('#headerImage');
      if (await headerInput.count() > 0) {
        await headerInput.setInputFiles(profile.headerPath);
        await page.waitForTimeout(2000);
        await confirmCropModal();
        // モーダルが完全に消えるまで待機してから次へ
        await page.waitForSelector('[data-name="modal"]', { state: 'hidden', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);
        console.log('  ✓ ヘッダー完了');
      } else {
        console.warn('  ✗ #headerImage が見つかりません');
      }
    }

    // ── アイコン（2段階: 円クリック→モーダル→カメラアイコン→filechooser） ─
    if (fs.existsSync(profile.iconPath)) {
      console.log('アイコンをアップロード中...');
      // Step1: 円形オーバーレイボタンをクリック（絵文字選択モーダルが開く）
      const iconOverlayBtn = page.locator('button.rounded-full').first();
      await iconOverlayBtn.click();
      await page.waitForTimeout(1500);

      // Step2: モーダル内のカメラアイコン（1番目のアイコン = アップロードボタン）をクリック
      // モーダルが「プロフィール画像を設定」を確認してからカメラを探す
      const modal = page.locator('[data-name="modal"]');
      if (await modal.count() > 0) {
        // モーダル内の最初のボタン（カメラアイコン）
        const cameraBtn = modal.locator('button').first();
        try {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 8000 }),
            cameraBtn.click(),
          ]);
          await fileChooser.setFiles(profile.iconPath);
          await page.waitForTimeout(2000);
          // 切り抜きモーダルの「この画像を使う」を押す
          await confirmCropModal();
          await page.waitForTimeout(1500);
          // 絵文字ピッカーモーダルの「設定」ボタンで確定
          const setBtn = page.locator('[data-name="modal"] button:has-text("設定")');
          if (await setBtn.count() > 0) {
            await setBtn.click();
            await page.waitForTimeout(2000);
          }
          await page.waitForSelector('[data-name="modal"]', { state: 'hidden', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(1500);
          console.log('  ✓ アイコン完了');
        } catch (e) {
          // filechooserが出なければ「キャンセル」を押してモーダルを閉じる
          console.warn('  ✗ アイコンfilechooser失敗:', e.message);
          const cancelBtn = page.locator('[data-name="modal"] button:has-text("キャンセル")');
          if (await cancelBtn.count() > 0) await cancelBtn.click();
          await page.waitForTimeout(1000);
        }
      } else {
        console.warn('  ✗ アイコン選択モーダルが開きませんでした');
      }
    }

    // ── 表示名（name="editNickname" 確認済み） ───────────────────
    console.log('表示名を設定中...');
    const nameEl = page.locator('input[name="editNickname"]');
    if (await nameEl.count() > 0) {
      await nameEl.click({ clickCount: 3 });
      await nameEl.fill(profile.displayName);
      console.log('  ✓ 表示名設定完了');
    } else {
      console.warn('  ✗ 表示名inputが見つかりませんでした');
    }

    // ── 自己紹介（name="editBiography" 確認済み） ───────────────
    console.log('自己紹介文を設定中...');
    const bioEl = page.locator('textarea[name="editBiography"]');
    if (await bioEl.count() > 0) {
      await bioEl.click({ clickCount: 3 });
      await bioEl.fill(profile.bio);
      console.log('  ✓ 自己紹介設定完了');
    } else {
      console.warn('  ✗ 自己紹介textareaが見つかりませんでした');
    }

    await page.waitForTimeout(1000);

    // ── 保存（フッターの「保存」ボタン） ─────────────────────────
    console.log('保存中...');
    // フッター固定の保存ボタンを対象（モーダルの submit ボタンを誤クリックしないよう last() を使用）
    const saveBtn = page.locator('button:has-text("保存")').last();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await page.waitForTimeout(4000);
      console.log('  ✓ 保存完了');
    } else {
      console.warn('  ✗ 保存ボタンが見つかりませんでした');
    }

    // 結果スクリーンショット
    await page.screenshot({ path: path.join(ASSETS, `debug-profile-a${ACCOUNT_ID}-after.png`) });
    console.log(`\nスクリーンショット保存: assets/note-accounts/debug-profile-a${ACCOUNT_ID}-after.png`);
    console.log('\n=== 完了 ===');

  } catch (err) {
    console.error('\nエラー:', err.message);
    await page.screenshot({ path: path.join(ASSETS, `debug-profile-a${ACCOUNT_ID}-error.png`) });
    console.log('エラースクリーンショット保存');
    await page.waitForTimeout(8000);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
