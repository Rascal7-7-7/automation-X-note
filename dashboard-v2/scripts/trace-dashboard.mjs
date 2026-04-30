#!/usr/bin/env node
/**
 * dashboard-v2 ブラウザトレース起動スクリプト
 *
 * Usage:
 *   node scripts/trace-dashboard.mjs start <run-name>   # トレース開始
 *   node scripts/trace-dashboard.mjs stop  <run-name>   # トレース停止 + bisect
 *   node scripts/trace-dashboard.mjs query <run-name>   # エラーサマリー表示
 *   node scripts/trace-dashboard.mjs clean              # .o11y/ を全削除
 *
 * 前提: Brave が --remote-debugging-port=9222 で起動済みであること
 */
import { execSync, spawn } from 'child_process';
import { existsSync, rmSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '../../.agents/skills/browser-trace/scripts');
const O11Y_DIR   = path.join(__dirname, '../.o11y');
const CDP_PORT   = process.env.CDP_PORT ?? '9222';

const [,, cmd, runName] = process.argv;

function run(script, ...args) {
  return execSync(`node ${path.join(SKILLS_DIR, script)} ${args.join(' ')}`, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
}

function checkBrave() {
  try {
    const r = execSync(`curl -s http://localhost:${CDP_PORT}/json/version`, { timeout: 2000 });
    const info = JSON.parse(r.toString());
    console.log(`[trace] CDP target: ${info.Browser} @ ${info.webSocketDebuggerUrl}`);
    return true;
  } catch {
    console.error(`[trace] ERROR: CDP port ${CDP_PORT} unreachable.`);
    console.error(`        Brave を起動してください:`);
    console.error(`        /Applications/Brave Browser.app/Contents/MacOS/Brave Browser --remote-debugging-port=${CDP_PORT} &`);
    process.exit(1);
  }
}

switch (cmd) {
  case 'start': {
    if (!runName) { console.error('run-name が必要です'); process.exit(1); }
    checkBrave();
    console.log(`[trace] 開始: ${runName} (port ${CDP_PORT})`);
    run('start-capture.mjs', CDP_PORT, runName);
    console.log(`[trace] 記録中... "node scripts/trace-dashboard.mjs stop ${runName}" で停止`);
    break;
  }
  case 'stop': {
    if (!runName) { console.error('run-name が必要です'); process.exit(1); }
    console.log(`[trace] 停止: ${runName}`);
    run('stop-capture.mjs', runName);
    console.log(`[trace] bisect 中...`);
    run('bisect-cdp.mjs', runName);
    console.log(`[trace] 完了 → .o11y/${runName}/`);
    // エラーサマリーを即表示
    execSync(`node ${path.join(SKILLS_DIR, 'query.mjs')} ${runName} errors`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    break;
  }
  case 'query': {
    if (!runName) { console.error('run-name が必要です'); process.exit(1); }
    const subcmd = process.argv[4] ?? 'errors';
    run('query.mjs', runName, subcmd, ...process.argv.slice(5));
    break;
  }
  case 'clean': {
    if (existsSync(O11Y_DIR)) {
      rmSync(O11Y_DIR, { recursive: true });
      console.log('[trace] .o11y/ 削除済み');
    } else {
      console.log('[trace] .o11y/ は存在しません');
    }
    break;
  }
  default: {
    console.log(`
使い方:
  node scripts/trace-dashboard.mjs start <run-name>   トレース開始
  node scripts/trace-dashboard.mjs stop  <run-name>   停止 + bisect + エラーサマリー
  node scripts/trace-dashboard.mjs query <run-name> [errors|hosts|list|summary]
  node scripts/trace-dashboard.mjs clean              .o11y/ 全削除

例 (ダッシュボード動作テスト):
  node scripts/trace-dashboard.mjs start sync-test
  # → Playwright or 手動でダッシュボードを操作
  node scripts/trace-dashboard.mjs stop  sync-test
    `);
  }
}
