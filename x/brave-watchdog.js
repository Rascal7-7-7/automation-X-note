/**
 * Brave CDP Watchdog
 * Brave が CDP ポートで応答しない場合に自動起動する
 * PM2 で常駐させるか scheduler から定期呼び出しで使用
 */
import 'dotenv/config';
import { logger } from '../shared/logger.js';

const MODULE   = 'brave:watchdog';
const CDP_URL  = 'http://localhost:9222';
const BRAVE_BIN = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1時間おき

async function isCdpReady() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

async function ensureBrave() {
  if (await isCdpReady()) return false; // already running

  logger.warn(MODULE, 'Brave CDP not responding — launching');
  const { spawn } = await import('child_process');
  spawn(BRAVE_BIN, ['--remote-debugging-port=9222', '--no-first-run'], {
    detached: true, stdio: 'ignore',
  }).unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isCdpReady()) {
      logger.info(MODULE, 'Brave launched successfully');
      return true;
    }
  }

  logger.error(MODULE, 'Brave failed to start in 15s');
  return false;
}

// 単発実行（scheduler から呼び出す場合）
export async function runWatchdog() {
  return ensureBrave();
}

// デーモンモード（PM2 で直接実行する場合）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  logger.info(MODULE, `starting watchdog — check every ${CHECK_INTERVAL_MS / 1000}s`);
  await ensureBrave();
  setInterval(ensureBrave, CHECK_INTERVAL_MS);
}
