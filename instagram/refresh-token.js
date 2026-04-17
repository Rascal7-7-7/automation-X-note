/**
 * Instagram 長期アクセストークン更新スクリプト（Instagram Login フロー）
 *
 * 使い方:
 *   node instagram/refresh-token.js
 *
 * 必要な .env 変数:
 *   FB_APP_ID        - Meta for Developers のアプリID
 *   FB_APP_SECRET    - Meta for Developers のアプリシークレット
 *
 * フロー:
 *   1. Instagram OAuth 認証 URL をブラウザで開く
 *   2. 認証後にリダイレクトされた URL を貼り付ける
 *   3. 短期トークン → 長期トークン（60日）に交換
 *   4. Instagram ユーザーID を取得
 *   5. .env に書き込む値を出力する
 *
 * ※ Facebookページ不要。Instagram Business/Creator アカウントに直接対応。
 */
import 'dotenv/config';
import readline from 'readline';
import { execFileSync } from 'child_process';

const APP_ID     = process.env.IG_APP_ID || process.env.FB_APP_ID;
const APP_SECRET = process.env.FB_APP_SECRET;
const REDIRECT   = 'https://localhost/callback';

// ── バリデーション ───────────────────────────────────────────────
if (!APP_ID || !APP_SECRET) {
  console.error('❌ .env に FB_APP_ID と FB_APP_SECRET を設定してください');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

// ── Instagram OAuth 認証 URL ─────────────────────────────────────
const SCOPE = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
].join(',');

const authUrl =
  `https://www.instagram.com/oauth/authorize` +
  `?force_reauth=true` +
  `&client_id=${APP_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&scope=${SCOPE}` +
  `&response_type=code`;

console.log('\n========================================');
console.log('Instagram アクセストークン更新（Instagram Login）');
console.log('========================================\n');
console.log('Step 1: ブラウザで以下のURLを開いてください\n');
console.log(authUrl);
console.log('');

try {
  execFileSync('open', [authUrl], { stdio: 'ignore' });
  console.log('（ブラウザを自動で開きました）\n');
} catch {
  console.log('（手動でコピーしてブラウザに貼り付けてください）\n');
}

console.log('Step 2: Instagram にログインして「許可する」を押してください');
console.log('   → エラーページ（localhost）にリダイレクトされますが正常です');
console.log('   → そのページのURLをコピーしてください\n');

const rawUrl = await ask('リダイレクト後のURL を貼り付けてください: ');

// URL からコードを抽出
let code;
try {
  const url = new URL(rawUrl.trim());
  code = url.searchParams.get('code');
  if (!code) throw new Error('code パラメータが見つかりません');
} catch (e) {
  console.error('\n❌ URL の解析に失敗しました:', e.message);
  rl.close();
  process.exit(1);
}

console.log('\nStep 3: 短期トークンを取得中...');

// ── 短期トークン取得（Instagram API）────────────────────────────
const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id:     APP_ID,
    client_secret: APP_SECRET,
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT,
    code,
  }),
});
const tokenData = await tokenRes.json();

if (!tokenData.access_token) {
  console.error('\n❌ 短期トークン取得失敗:', JSON.stringify(tokenData));
  rl.close();
  process.exit(1);
}

const shortToken = tokenData.access_token;
const igUserId   = tokenData.user_id;
console.log('✅ 短期トークン取得成功（Instagram User ID:', igUserId, '）');

// ── 長期トークンに交換（60日有効） ─────────────────────────────
console.log('Step 4: 長期トークンに交換中（60日有効）...');

const longRes = await fetch(
  `https://graph.instagram.com/access_token` +
  `?grant_type=ig_exchange_token` +
  `&client_id=${APP_ID}` +
  `&client_secret=${APP_SECRET}` +
  `&access_token=${shortToken}`
);
const longData = await longRes.json();

if (!longData.access_token) {
  console.error('\n❌ 長期トークン変換失敗:', JSON.stringify(longData));
  rl.close();
  process.exit(1);
}

const longToken = longData.access_token;
const expiresIn = longData.expires_in ?? 5184000;
const expiresAt = new Date(Date.now() + expiresIn * 1000).toLocaleDateString('ja-JP');

console.log('✅ 長期トークン取得成功（有効期限:', expiresAt, '）');

// ── Instagram アカウント情報取得 ────────────────────────────────
console.log('Step 5: Instagram アカウント情報を取得中...');

const meRes = await fetch(
  `https://graph.instagram.com/me` +
  `?fields=id,username,account_type` +
  `&access_token=${longToken}`
);
const meData = await meRes.json();

if (meData.id) {
  console.log(`✅ アカウント確認: @${meData.username} (ID: ${meData.id}, タイプ: ${meData.account_type})`);
} else {
  console.warn('\n⚠️  アカウント情報の取得に失敗しました:', JSON.stringify(meData));
}

// ── 出力 ──────────────────────────────────────────────────────────
console.log('\n========================================');
console.log('.env に以下を追加・更新してください:');
console.log('========================================\n');
console.log(`INSTAGRAM_ACCESS_TOKEN=${longToken}`);
console.log(`INSTAGRAM_BUSINESS_ACCOUNT_ID=${meData.id ?? igUserId}`);
console.log(`# 有効期限: ${expiresAt}（60日ごとに再実行してください）`);

rl.close();
