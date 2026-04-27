import fs from 'fs';
import { saveFile } from './file-utils.js';
import path from 'path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ファイルベース永続キュー（非同期ロック付き）
 *
 * キュー種別:
 *   main.jsonl   — 通常キュー
 *   retry.jsonl  — リトライ待ち（失敗アイテム）
 *   failed.jsonl — 最大リトライ超過（手動確認用）
 */
export class FileQueue {
  constructor(filePath) {
    this.filePath = filePath;
    this.lockPath = filePath + '.lock';

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '');
    }
  }

  /** 非同期スピンロック（50ms間隔、最大10秒待機） */
  async acquireLock() {
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        fs.writeFileSync(this.lockPath, process.pid.toString(), { flag: 'wx' });
        return;
      } catch {
        if (Date.now() > deadline) {
          throw new Error(`lock timeout: ${this.lockPath}`);
        }
        await sleep(50);
      }
    }
  }

  releaseLock() {
    try { fs.unlinkSync(this.lockPath); } catch { /* already gone */ }
  }

  async push(item, { dedupKey } = {}) {
    const entry = JSON.stringify({ ...item, enqueuedAt: new Date().toISOString() });
    await this.acquireLock();
    try {
      if (dedupKey) {
        const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
        const isDup = lines.some(l => { try { return JSON.parse(l)[dedupKey] === item[dedupKey]; } catch { return false; } });
        if (isDup) return false;
      }
      fs.appendFileSync(this.filePath, entry + '\n');
      return true;
    } finally {
      this.releaseLock();
    }
  }

  async shift() {
    await this.acquireLock();
    try {
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
      if (lines.length === 0) return null;

      const item = JSON.parse(lines[0]);
      saveFile(this.filePath, lines.slice(1).join('\n') + (lines.length > 1 ? '\n' : ''));
      return item;
    } finally {
      this.releaseLock();
    }
  }

  size() {
    return fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean).length;
  }
}

/**
 * リトライ付きキュー処理
 * - retry優先で取り出し
 * - maxRetries超過でfailedに移動（ログ付き）
 */
export async function processWithRetry(mainQ, retryQ, failedQ, handler, maxRetries = 3) {
  const item = retryQ.size() > 0 ? await retryQ.shift() : await mainQ.shift();
  if (!item) return null;

  const attempts = (item._attempts ?? 0) + 1;

  try {
    await handler(item);
    return { ok: true, item };
  } catch (err) {
    if (attempts < maxRetries) {
      await retryQ.push({ ...item, _attempts: attempts, _lastError: err.message });
    } else {
      await failedQ.push({
        ...item,
        _attempts: attempts,
        _failedAt: new Date().toISOString(),
        _finalError: err.message,
      });
      // maxRetries 超過は呼び出し元がログを残せるよう err を返す
    }
    return { ok: false, item, err, attempts };
  }
}
