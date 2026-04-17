#!/usr/bin/env node
/**
 * YouTube OAuth2 refresh_token 取得スクリプト
 * 使い方: node youtube/get-refresh-token.js
 */
import 'dotenv/config';
import { execFile } from 'child_process';
import https from 'https';
import http from 'http';
import { parse } from 'url';

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3002/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',  // 字幕・音声API用
].join(' ');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('環境変数が設定されていません');
  console.error('実行方法:');
  console.error('  YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node get-refresh-token.js');
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n=== YouTube OAuth2 認証 ===');
console.log('ブラウザで以下のURLを開いてください:\n');
console.log(authUrl + '\n');

// xdg-open でブラウザを自動起動（Linux）
execFile('xdg-open', [authUrl], (err) => {
  if (err) console.log('（ブラウザの自動起動に失敗。上記URLを手動で開いてください）');
});

// コールバック待受サーバー
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
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }).toString();

  const options = {
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
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
      console.log('\n=== 取得成功！.env に追記してください ===\n');
      console.log(`YOUTUBE_CLIENT_ID=${CLIENT_ID}`);
      console.log(`YOUTUBE_CLIENT_SECRET=${CLIENT_SECRET}`);
      console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('\n（YOUTUBE_CHANNEL_IDは後でYouTube Studioから取得）');
    });
  });

  tokenReq.on('error', (e) => console.error('リクエストエラー:', e));
  tokenReq.write(body);
  tokenReq.end();
});

server.listen(3002, () => {
  console.log('コールバック待受中... (port 3002)\n');
});
