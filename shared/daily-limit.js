/**
 * 日別投稿数制限（ファイル永続化）
 * - インメモリ版の弱点（プロセス再起動でリセット）を解消
 * - logs/daily-limit.json で状態を永続化
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIMIT_FILE = path.join(__dirname, '../../logs/daily-limit.json');

const MAX_PER_DAY = 5;

function loadState() {
  try {
    if (fs.existsSync(LIMIT_FILE)) {
      return JSON.parse(fs.readFileSync(LIMIT_FILE, 'utf8'));
    }
  } catch { /* corrupt file → reset */ }
  return { date: '', count: 0 };
}

function saveState(state) {
  const dir = path.dirname(LIMIT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = LIMIT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, LIMIT_FILE);
}

/**
 * 投稿可否を判定し、可能なら count をインクリメントして true を返す。
 * @param {number} max 上限（デフォルト5）
 */
export function canPost(max = MAX_PER_DAY) {
  const today = new Date().toDateString();
  const state = loadState();

  if (state.date !== today) {
    state.date = today;
    state.count = 0;
  }

  if (state.count >= max) return false;

  state.count++;
  saveState(state);
  return true;
}

/** 今日の投稿数を返す（確認用） */
export function todayCount() {
  const today = new Date().toDateString();
  const state = loadState();
  return state.date === today ? state.count : 0;
}
