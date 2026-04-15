/**
 * Lightpanda ブラウザヘルパー
 *
 * Lightpanda は AI 特化型ヘッドレスブラウザ（Playwright の 9倍高速・1/16メモリ）
 * CDP プロトコルで Playwright と互換性あり
 *
 * 使用方法:
 *   import { withLightpanda } from '../shared/lightpanda.js';
 *   await withLightpanda(async (page) => { ... });
 *
 * Lightpanda が利用不可の場合は通常の Playwright にフォールバック
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

const MODULE = 'lightpanda';
const LP_HOST = '127.0.0.1';
const LP_PORT = 9222;
const LP_WS_URL = `ws://${LP_HOST}:${LP_PORT}`;

const LP_BINARY_CANDIDATES = [
  path.join(os.homedir(), '.local/bin/lightpanda'),
  '/usr/local/bin/lightpanda',
  '/usr/bin/lightpanda',
];

export function getLightpandaBinary() {
  for (const p of LP_BINARY_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

const DEFAULT_OPTS = {
  locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
};

/**
 * Lightpanda サーバーを起動して CDP 接続し、コールバックを実行
 * 利用不可の場合は通常の Playwright にフォールバック
 * @template T
 * @param {(page: import('playwright').Page) => Promise<T>} fn
 * @param {object} opts
 * @returns {Promise<T>}
 */
export async function withLightpanda(fn, opts = {}) {
  const binary = getLightpandaBinary();
  if (!binary) {
    logger.info(MODULE, 'binary not found → fallback to Playwright');
    return withPlaywright(fn, opts);
  }

  let lpProcess = null;
  let browser = null;

  try {
    lpProcess = spawn(binary, ['serve', '--host', LP_HOST, '--port', String(LP_PORT)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    lpProcess.on('error', (e) => logger.info(MODULE, `spawn error: ${e.message}`));

    await waitForCDP(LP_WS_URL, 5000);
    browser = await chromium.connectOverCDP(LP_WS_URL);

    const context = await browser.newContext({ ...DEFAULT_OPTS, ...opts });
    const page = await context.newPage();

    logger.info(MODULE, 'connected via CDP (lightpanda)');
    const result = await fn(page);
    await context.close();
    return result;

  } catch (err) {
    logger.info(MODULE, `lightpanda error: ${err.message} → fallback to Playwright`);
    return withPlaywright(fn, opts);

  } finally {
    if (browser) await browser.close().catch(() => {});
    if (lpProcess && !lpProcess.killed) {
      lpProcess.kill();
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

/** 通常の Playwright でフォールバック実行 */
async function withPlaywright(fn, opts = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...DEFAULT_OPTS, ...opts });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/** CDP エンドポイントが応答するまでポーリング */
async function waitForCDP(wsUrl, timeoutMs) {
  const httpUrl = wsUrl.replace('ws://', 'http://') + '/json/version';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(httpUrl, { signal: AbortSignal.timeout(500) });
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Lightpanda CDP not ready at ${wsUrl} after ${timeoutMs}ms`);
}
