#!/usr/bin/env node
/**
 * YouTube OAuth2 refresh_token 取得スクリプト
 *
 * 使い方:
 *   node youtube/get-refresh-token.js           # アカウント1（デフォルト）
 *   node youtube/get-refresh-token.js --account=2  # アカウント2
 */
import 'dotenv/config';
import { execFile } from 'child_process';
import https from 'https';
import http from 'http';
import { parse } from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE  = path.join(__dirname, '../.env');

function patchEnv(key, value) {
  let content = '';
  try { content = fs.readFileSync(ENV_FILE, 'utf8'); } catch { /* new file */ }
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    content = content.trimEnd() + `\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, content);
}

// ── CLI引数パース ─────────────────────────────────────────────────────

const accountArg = process.argv.find(a => a.startsWith('--account='));
const accountId  = accountArg ? Number(accountArg.split('=')[1]) : 1;

if (![1, 2].includes(accountId)) {
  console.error(`エラー: --account は 1 または 2 を指定してください（指定値: ${accountId}）`);
  process.exit(1);
}

// ── 認証情報の読み込み ────────────────────────────────────────────────

const suffix      = accountId === 1 ? '' : `_${accountId}`;
const CLIENT_ID     = process.env[`YOUTUBE_CLIENT_ID${suffix}`];
const CLIENT_SECRET = process.env[`YOUTUBE_CLIENT_SECRET${suffix}`];

const REDIRECT_URI = 'http://localhost:3002/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',  // 字幕・音声API用
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  const idKey  = `YOUTUBE_CLIENT_ID${suffix}`;
  const secKey = `YOUTUBE_CLIENT_SECRET${suffix}`;
  console.error(`\n環境変数が設定されていません（アカウント${accountId}）`);
  console.error('以下のいずれかの方法で実行してください:\n');
  console.error(`  # .env に設定済みの場合`);
  console.error(`  node youtube/get-refresh-token.js${accountId === 2 ? ' --account=2' : ''}\n`);
  console.error(`  # 環境変数をインラインで渡す場合`);
  console.error(`  ${idKey}=xxx ${secKey}=yyy node youtube/get-refresh-token.js${accountId === 2 ? ' --account=2' : ''}`);
  process.exit(1);
}

// ── OAuth2 認証URL構築 ────────────────────────────────────────────────

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log(`\n=== YouTube OAuth2 認証（アカウント${accountId}） ===`);
console.log('ブラウザで以下のURLを開いてください:\n');
console.log(authUrl + '\n');

// xdg-open でブラウザを自動起動（Linux）/ open（macOS）
const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
execFile(opener, [authUrl], (err) => {
  if (err) console.log('（ブラウザの自動起動に失敗。上記URLを手動で開いてください）');
});

// ── コールバック待受サーバー ──────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsed = parse(req.url, true);
  if (parsed.pathname !== '/callback') return;

  const code = parsed.query.code;
  if (!code) {
    res.end('認証コードが取得できませんでした');
    return;
  }

  res.end('<html><body><h2>認証完了！ターミナルを確認してください</h2></body></html>');
  server.close();

  // code → tokens 交換
  const body = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    'authorization_code',
  }).toString();

  const options = {
    hostname: 'oauth2.googleapis.com',
    path:     '/token',
    method:   'POST',
    headers: {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const tokenReq = https.request(options, (tokenRes) => {
    let data = '';
    tokenRes.on('data', (chunk) => { data += chunk; });
    tokenRes.on('end', () => {
      const tokens = JSON.parse(data);
      if (tokens.error) {
        console.error('\nエラー:', tokens.error_description || tokens.error);
        return;
      }

      const refreshKey = `YOUTUBE_REFRESH_TOKEN${suffix}`;
      const channelKey = `YOUTUBE_CHANNEL_ID${suffix}`;

      patchEnv(refreshKey, tokens.refresh_token);
      console.log(`\n=== 取得成功！.env に自動保存しました（アカウント${accountId}） ===\n`);
      console.log(`${refreshKey}=${tokens.refresh_token}`);
      console.log(`\n.env 更新済み。次のコマンドでPM2に反映:\n  pm2 restart sns-bridge sns-scheduler --update-env`);
      console.log(`\n（${channelKey} は後でYouTube Studioから取得）`);

      if (accountId === 2) {
        console.log('\n次のステップ:');
        console.log('  1. 上記の値を .env に追記する');
        console.log('  2. YouTube Studio → 設定 → チャンネル詳細 → チャンネルIDをコピー');
        console.log(`  3. .env に ${channelKey}=<チャンネルID> を追記する`);
        console.log('  4. アップロード時: runUpload({ type: "chatgpt-short" }) または');
        console.log('                    runUpload({ type: "short", accountId: 2 })');
      }
    });
  });

  tokenReq.on('error', (e) => console.error('リクエストエラー:', e));
  tokenReq.write(body);
  tokenReq.end();
});

server.listen(3002, () => {
  console.log('コールバック待受中... (port 3002)\n');
});
