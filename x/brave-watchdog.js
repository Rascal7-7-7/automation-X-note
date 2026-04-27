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
    if (!res.ok) return false;
    const info = await res.json();

    // HTTP応答だけでなく、実際にWS経由でCDPコマンドを実行して疎通確認
    // ゾンビ状態（WS接続はできるがコマンドが返らない）を検出する
    const wsUrl = info.webSocketDebuggerUrl;
    if (!wsUrl) return false;

    return await new Promise((resolve) => {
      const { WebSocket } = globalThis;
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => { ws.close(); resolve(false); }, 4000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
      };
      ws.onmessage = () => {
        clearTimeout(timer);
        ws.close();
        resolve(true);
      };
      ws.onerror = () => { clearTimeout(timer); resolve(false); };
      ws.onclose = () => { clearTimeout(timer); };
    });
  } catch { return false; }
}

async function killBrave() {
  const { execFile } = await import('child_process');
  await new Promise(resolve => execFile('pkill', ['-f', 'Brave Browser'], () => resolve()));
  await new Promise(r => setTimeout(r, 1500));
}

async function ensureBrave() {
  if (await isCdpReady()) return false; // already running

  // HTTP応答あり・CDPゾンビの可能性 → 強制再起動
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      logger.warn(MODULE, 'Brave CDP zombie detected — killing and restarting');
      await killBrave();
    }
  } catch { /* port closed = normal down state */ }

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
