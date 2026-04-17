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

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE  = path.join(__dirname, '../.note-session.json');

async function main() {
  console.log('ブラウザを起動します...');
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

  await context.storageState({ path: SESSION_FILE });
  console.log(`\nセッションを保存しました: ${SESSION_FILE}`);
  console.log('これで note の自動投稿が動作します。');

  await browser.close();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
