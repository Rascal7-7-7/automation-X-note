/**
 * note.com セッション保存スクリプト
 *
 * ブラウザを有頭モードで開きます。
 * note.com にログインした後、Enter キーを押すとセッションが保存されます。
 *
 * 使い方:
 *   node note/save-session.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import readline from 'readline';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNT_ID = Number(process.env.NOTE_ACCOUNT ?? process.argv[2] ?? 1);
const SESSION_FILES = { 1: '.note-session.json', 2: '.note-session-2.json', 3: '.note-session-3.json' };
const SESSION_FILE  = path.join(__dirname, '..', SESSION_FILES[ACCOUNT_ID] ?? '.note-session.json');

async function main() {
  console.log(`ブラウザを起動します... (アカウント ${ACCOUNT_ID})`);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log('\nnote.com のログインページが開きました。');
  console.log('ブラウザでログインしてください（メール/パスワード、または Google ログイン）。');
  console.log('\nログイン完了後、このターミナルで Enter キーを押してください...');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('', resolve));
  rl.close();

  const url = page.url();
  if (url.includes('/login')) {
    console.error('まだログインページにいます。ログインを完了してから Enter を押してください。');
    await browser.close();
    process.exit(1);
  }

  // editor.note.com サブドメインのセッションを初期化してから保存
  console.log('エディタを初期化中...');
  await page.goto('https://editor.note.com/new', { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(5000);

  await context.storageState({ path: SESSION_FILE });
  console.log(`\nセッションを保存しました: ${SESSION_FILE}`);
  console.log('これで note の自動投稿が動作します。');

  await browser.close();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
