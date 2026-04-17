/**
 * 通知モジュール
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

export function notifyError(title, message) {
  writeLog('ERROR', title, message);
  macosNotify(`🔴 ${title}`, message);
}

export function notifyWarn(title, message) {
  writeLog('WARN', title, message);
  macosNotify(`⚠️ ${title}`, message, 'Ping');
}
