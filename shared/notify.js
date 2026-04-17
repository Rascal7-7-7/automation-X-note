/**
 * 通知モジュール
 * - Discord Webhook（DISCORD_WEBHOOK_URL が設定されている場合）
 * - macOS デスクトップ通知（osascript）
 * - alerts.log へ記録
 */
import { execFileSync } from 'child_process';
import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ALERTS_LOG = path.join(__dirname, '../logs/alerts.log');

function writeLog(level, title, message) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    title,
    message,
  }) + '\n';
  try {
    mkdirSync(path.dirname(ALERTS_LOG), { recursive: true });
    appendFileSync(ALERTS_LOG, line);
  } catch { /* ログ書き込み失敗は無視 */ }
}

function macosNotify(title, message, sound = 'Basso') {
  try {
    execFileSync('osascript', [
      '-e',
      `display notification "${message}" with title "${title}" sound name "${sound}"`,
    ], { stdio: 'ignore' });
  } catch { /* 通知失敗は無視 */ }
}

async function discordNotify(title, message, color = 0xe74c3c) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title,
          description: message,
          color,
          timestamp: new Date().toISOString(),
          footer: { text: 'automation' },
        }],
      }),
    });
  } catch { /* Discord 通知失敗は無視 */ }
}

export async function notifyError(title, message) {
  writeLog('ERROR', title, message);
  macosNotify(`🔴 ${title}`, message);
  await discordNotify(`🔴 ${title}`, message, 0xe74c3c); // 赤
}

export async function notifyWarn(title, message) {
  writeLog('WARN', title, message);
  macosNotify(`⚠️ ${title}`, message, 'Ping');
  await discordNotify(`⚠️ ${title}`, message, 0xf39c12); // オレンジ
}

export async function notifyInfo(title, message) {
  writeLog('INFO', title, message);
  await discordNotify(`✅ ${title}`, message, 0x2ecc71); // 緑
}
