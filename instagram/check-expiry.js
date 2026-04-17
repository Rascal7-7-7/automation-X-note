/**
 * Instagram トークン期限監視
 * - .instagram-token-dates.json に発行日を記録
 * - 残り10日以内になったら macOS 通知 + alerts.log に記録
 *
 * 使い方（初回設定）:
 *   node instagram/check-expiry.js --init
 *
 * 通常実行（スケジューラから毎日）:
 *   node instagram/check-expiry.js
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { notifyError, notifyWarn } from '../shared/notify.js';
import { logger } from '../shared/logger.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DATES_FILE  = path.join(__dirname, '.instagram-token-dates.json');
const MODULE      = 'instagram:check-expiry';
const EXPIRY_DAYS = 60;
const WARN_DAYS   = 10;

function loadDates() {
  if (!existsSync(DATES_FILE)) return {};
  return JSON.parse(readFileSync(DATES_FILE, 'utf8'));
}

function saveDates(dates) {
  writeFileSync(DATES_FILE, JSON.stringify(dates, null, 2));
}

function daysLeft(issuedAt) {
  const issued  = new Date(issuedAt).getTime();
  const expires = issued + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000));
}

export async function runCheckExpiry() {
  const dates = loadDates();
  if (!dates.account1) {
    logger.warn(MODULE, '初回設定が必要です: node instagram/check-expiry.js --init');
    return;
  }
  for (const [key, info] of Object.entries(dates)) {
    const remaining = daysLeft(info.issuedAt);
    logger.info(MODULE, `${key} (@${info.username}): 残り${remaining}日`);
    if (remaining <= 0) {
      notifyError(
        `Instagram トークン期限切れ: @${info.username}`,
        `${key} のトークンが期限切れです。Meta Developers で再生成してください。`
      );
    } else if (remaining <= WARN_DAYS) {
      notifyWarn(
        `Instagram トークン期限まで${remaining}日: @${info.username}`,
        `Meta Developers → Instagram API → Instagramログインによる API設定 → トークンを生成`
      );
    }
  }
}

// スタンドアロン実行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--init')) {
    const today = new Date().toISOString();
    const dates = {
      account1: { username: 'affi_master_jp',  issuedAt: today },
      account2: { username: 'ai_side_hack_',   issuedAt: today },
    };
    saveDates(dates);
    console.log('✅ トークン発行日を記録しました:', DATES_FILE);
    console.log(JSON.stringify(dates, null, 2));
  } else {
    await runCheckExpiry();
  }
}
