/**
 * 各SNSプラットフォームへの投稿状況確認スクリプト
 */
import 'dotenv/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../.x-session.json');
const RESULTS = {};

// =============================
// X (Twitter) 確認
// =============================
async function checkX() {
  console.log('\n=== X (Twitter) 確認中 ===');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      locale: 'ja-JP',
    });
    const page = await context.newPage();

    // ホームに移動してログイン確認
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const newTweetBtn = await page.locator('[data-testid="SideNav_NewTweet_Button"]').count();
    if (newTweetBtn === 0) {
      // ログインが必要
      console.log('セッションなし。ログイン試行中...');
      await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('input[autocomplete="username"]', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const usernameInput = page.locator('input[autocomplete="username"]');
      await usernameInput.click();
      await page.evaluate((email) => {
        const input = document.querySelector('input[autocomplete="username"]');
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, email);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, process.env.X_EMAIL);
      await page.waitForTimeout(1000);
      await page.locator('[data-testid="LoginForm_Next_Button"]').or(page.getByText('次へ')).or(page.getByText('Next')).first().click();
      await page.waitForTimeout(2000);

      const extraInput = page.locator('input[data-testid="ocfEnterTextTextInput"]');
      if (await extraInput.count() > 0) {
        await extraInput.fill(process.env.X_EMAIL);
        await page.locator('[data-testid="ocfEnterTextNextButton"]').click();
        await page.waitForTimeout(2000);
      }

      await page.waitForSelector('input[type="password"]', { timeout: 15000 });
      await page.locator('input[type="password"]').fill(process.env.X_PASSWORD);
      await page.locator('[data-testid="LoginForm_Login_Button"]').or(page.getByText('ログイン')).or(page.getByText('Log in')).first().click();
      await page.waitForTimeout(5000);
    }

    // プロフィールURLをサイドナビから取得
    const profileLink = await page.locator('[data-testid="AppTabBar_Profile_Link"]').getAttribute('href').catch(() => null);
    const username = profileLink ? profileLink.replace('/', '') : null;
    console.log('Xユーザー名:', username || '取得失敗');

    if (username) {
      await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);

      // ツイート一覧取得
      const tweets = await page.locator('[data-testid="tweet"]').all();
      const results = [];
      for (const tweet of tweets.slice(0, 5)) {
        const text = await tweet.locator('[data-testid="tweetText"]').textContent().catch(() => '(テキストなし)');
        const time = await tweet.locator('time').getAttribute('datetime').catch(() => null);
        results.push({ text: text?.trim().substring(0, 80), time });
      }

      RESULTS.x = {
        status: '確認OK',
        username,
        recentPosts: results,
        lastPostDate: results[0]?.time || '不明',
      };
      console.log(`投稿数確認: ${results.length}件`);
      results.forEach((r, i) => console.log(`  [${i+1}] ${r.time} - ${r.text}`));
    } else {
      RESULTS.x = { status: '問題あり', error: 'プロフィールURL取得失敗' };
    }

    await context.storageState({ path: SESSION_FILE }).catch(() => {});
  } catch (err) {
    RESULTS.x = { status: 'スキップ', error: err.message };
    console.error('X確認エラー:', err.message);
  } finally {
    await browser?.close();
  }
}

// =============================
// note 確認
// =============================
async function checkNote() {
  console.log('\n=== note 確認中 ===');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      locale: 'ja-JP',
    });
    const page = await context.newPage();

    // noteログイン
    await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // メール/パスワードでログイン
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[name="email"]'));
    if (await emailInput.count() > 0) {
      await emailInput.fill(process.env.X_EMAIL); // note もGmailを使っている可能性
      const pwInput = page.locator('input[type="password"]');
      if (await pwInput.count() > 0) {
        await pwInput.fill(process.env.NOTE_PASSWORD || process.env.X_PASSWORD);
        await page.locator('button[type="submit"]').or(page.getByText('ログイン')).first().click();
        await page.waitForTimeout(4000);
      }
    }

    // ダッシュボードへ
    await page.goto('https://note.com/notes', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log('現在のURL:', currentUrl);

    if (currentUrl.includes('/login') || currentUrl.includes('/signup')) {
      RESULTS.note = { status: 'スキップ', error: 'ログイン失敗' };
      return;
    }

    // 記事一覧確認
    const articles = await page.locator('article, .o-note, [class*="NoteCard"], [class*="noteCard"]').all();
    console.log(`記事候補: ${articles.length}件`);

    // ダッシュボード（クリエイターページ）へ
    await page.goto('https://note.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log('ダッシュボードURL:', page.url());

    const drafts = await page.locator('[class*="draft"], [class*="Draft"]').all();
    const published = await page.locator('[class*="publish"], [class*="Publish"]').all();
    console.log(`下書き: ${drafts.length}, 公開: ${published.length}`);

    // ページタイトルやテキストを取得
    const pageText = await page.locator('main, #main, [role="main"]').textContent().catch(() => '');
    const hasDraft = pageText.includes('下書き') || pageText.includes('draft');

    RESULTS.note = {
      status: '確認OK',
      url: page.url(),
      draftFound: hasDraft,
      pagePreview: pageText.substring(0, 200),
    };

  } catch (err) {
    RESULTS.note = { status: 'スキップ', error: err.message };
    console.error('note確認エラー:', err.message);
  } finally {
    await browser?.close();
  }
}

// =============================
// Instagram 確認（Graph API）
// =============================
async function checkInstagram() {
  console.log('\n=== Instagram 確認中 ===');
  try {
    // Instagram Graph APIを使用（ACCESS_TOKEN_1）
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN_1;
    const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID_1;

    if (!accessToken || !accountId) {
      RESULTS.instagram = { status: 'スキップ', error: 'ACCESS_TOKENまたはACCOUNT_IDが未設定' };
      return;
    }

    // メディア一覧取得
    const url = `https://graph.facebook.com/v20.0/${accountId}/media?fields=id,caption,media_type,timestamp,permalink,like_count,comments_count&limit=5&access_token=${accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error('Instagram API エラー:', data.error.message);
      RESULTS.instagram = { status: '問題あり', error: data.error.message };
      return;
    }

    const posts = data.data || [];
    console.log(`Instagram投稿数: ${posts.length}件`);
    posts.forEach((p, i) => {
      console.log(`  [${i+1}] ${p.timestamp} - ${p.media_type} - ${(p.caption || '').substring(0, 60)}`);
    });

    RESULTS.instagram = {
      status: posts.length > 0 ? '確認OK' : '問題あり（投稿なし）',
      postCount: posts.length,
      recentPosts: posts.map(p => ({
        id: p.id,
        type: p.media_type,
        timestamp: p.timestamp,
        caption: (p.caption || '').substring(0, 100),
        permalink: p.permalink,
        likes: p.like_count,
        comments: p.comments_count,
      })),
      lastPostDate: posts[0]?.timestamp || '不明',
    };

    // アカウント情報も取得
    const acctUrl = `https://graph.facebook.com/v20.0/${accountId}?fields=name,username,biography,followers_count,media_count&access_token=${accessToken}`;
    const acctRes = await fetch(acctUrl);
    const acctData = await acctRes.json();
    if (!acctData.error) {
      console.log(`アカウント: @${acctData.username} フォロワー: ${acctData.followers_count}`);
      RESULTS.instagram.account = acctData;
    }

  } catch (err) {
    RESULTS.instagram = { status: 'スキップ', error: err.message };
    console.error('Instagram確認エラー:', err.message);
  }
}

// =============================
// YouTube 確認
// =============================
async function checkYouTube() {
  console.log('\n=== YouTube 確認中 ===');
  try {
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    const videoId = 'XuFCicc3y0I';

    // YouTube Data API v3 でチャンネルの動画一覧取得
    // まずAPIキーが使えるかGEMINI_API_KEYは違う、別途確認
    // refresh_tokenからaccess_tokenを取得
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      RESULTS.youtube = { status: 'スキップ', error: 'YouTube OAuth認証情報が未設定' };
      return;
    }

    // アクセストークン取得
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('アクセストークン取得失敗:', tokenData.error);
      RESULTS.youtube = { status: '問題あり', error: `トークン取得失敗: ${tokenData.error}` };
      return;
    }

    const accessToken = tokenData.access_token;
    console.log('YouTubeアクセストークン取得成功');

    // 特定動画の確認
    const videoUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,statistics,status&access_token=${accessToken}`;
    const videoRes = await fetch(videoUrl);
    const videoData = await videoRes.json();

    const video = videoData.items?.[0];
    if (video) {
      console.log(`動画「${video.snippet.title}」`);
      console.log(`  ステータス: ${video.status.privacyStatus}`);
      console.log(`  視聴回数: ${video.statistics.viewCount}`);
      console.log(`  公開日: ${video.snippet.publishedAt}`);
    } else {
      console.log('指定動画が見つかりません');
    }

    // チャンネルの動画一覧（最新5件）
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?channelId=${channelId}&part=snippet&order=date&maxResults=5&access_token=${accessToken}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    const videos = searchData.items || [];
    console.log(`\nチャンネル最新動画: ${videos.length}件`);
    videos.forEach((v, i) => {
      console.log(`  [${i+1}] ${v.snippet.publishedAt} - ${v.snippet.title}`);
    });

    RESULTS.youtube = {
      status: video ? '確認OK' : '問題あり（動画ID見つからず）',
      targetVideo: video ? {
        title: video.snippet.title,
        status: video.status.privacyStatus,
        viewCount: video.statistics.viewCount,
        likeCount: video.statistics.likeCount,
        publishedAt: video.snippet.publishedAt,
      } : null,
      recentVideos: videos.map(v => ({
        id: v.id.videoId,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
      })),
    };

  } catch (err) {
    RESULTS.youtube = { status: 'スキップ', error: err.message };
    console.error('YouTube確認エラー:', err.message);
  }
}

// =============================
// メイン実行
// =============================
async function main() {
  console.log('=== SNSプラットフォーム投稿状況確認 ===');
  console.log(`実行日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

  // Instagram と YouTube は API なので並列実行可能
  // X と note は Playwright なので順番に実行（リソース節約）
  await checkX();
  await checkNote();
  await Promise.all([checkInstagram(), checkYouTube()]);

  // 結果サマリー
  console.log('\n\n========== 結果サマリー ==========');

  // X
  const x = RESULTS.x || {};
  console.log(`\n### X: [${x.status || 'スキップ'}]`);
  if (x.recentPosts?.length > 0) {
    console.log('- 最近の投稿:');
    x.recentPosts.forEach((p, i) => console.log(`  ${i+1}. [${p.time}] ${p.text}`));
    console.log(`- 最終投稿日: ${x.lastPostDate}`);
  } else {
    console.log(`- エラー: ${x.error || '投稿なし'}`);
  }

  // note
  const note = RESULTS.note || {};
  console.log(`\n### note: [${note.status || 'スキップ'}]`);
  if (note.error) console.log(`- エラー: ${note.error}`);
  else console.log(`- 下書き状態: ${note.draftFound ? '下書きあり' : '下書きなし（または確認不可）'}`);

  // Instagram
  const insta = RESULTS.instagram || {};
  console.log(`\n### Instagram: [${insta.status || 'スキップ'}]`);
  if (insta.account) console.log(`- アカウント: @${insta.account.username} (フォロワー: ${insta.account.followers_count})`);
  if (insta.recentPosts?.length > 0) {
    console.log(`- 投稿状況: ${insta.postCount}件確認`);
    insta.recentPosts.forEach((p, i) => console.log(`  ${i+1}. [${p.timestamp}] ${p.type} - ${p.caption.substring(0,60)}`));
  } else {
    console.log(`- エラー/状況: ${insta.error || '投稿なし'}`);
  }

  // YouTube
  const yt = RESULTS.youtube || {};
  console.log(`\n### YouTube: [${yt.status || 'スキップ'}]`);
  if (yt.targetVideo) {
    console.log(`- 動画「${yt.targetVideo.title}」`);
    console.log(`  ステータス: ${yt.targetVideo.status} / 視聴回数: ${yt.targetVideo.viewCount} / 公開日: ${yt.targetVideo.publishedAt}`);
  } else {
    console.log(`- エラー: ${yt.error || '動画情報なし'}`);
  }
  if (yt.recentVideos?.length > 0) {
    console.log('- 最近の動画:');
    yt.recentVideos.forEach((v, i) => console.log(`  ${i+1}. [${v.publishedAt}] ${v.title}`));
  }
}

main().catch(console.error);
