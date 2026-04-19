/**
 * 品質フィードバック永続化
 * - reviewContent の結果から繰り返し発生する問題点を抽出・保存
 * - 次回生成時にプロンプトへ注入してベースライン品質を向上
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '../analytics/quality-feedback.json');
const MAX_ENTRIES_PER_SET = 10; // personaSetごとに直近10件を保持

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveStore(store) {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

/**
 * レビュー結果を保存
 * @param {string} personaSet
 * @param {Array} results - reviewContent の results 配列
 * @param {number} avgScore
 */
export function saveFeedback(personaSet, results, avgScore) {
  const issues = results
    .filter(r => r.score < 7)
    .map(r => ({ persona: r.name, score: r.score, bad: r.bad }));

  if (issues.length === 0) return; // 全ペルソナOKなら記録不要

  const store = loadStore();
  if (!store[personaSet]) store[personaSet] = [];

  store[personaSet].push({
    ts: Date.now(),
    avgScore,
    issues,
  });

  // 直近N件のみ保持
  if (store[personaSet].length > MAX_ENTRIES_PER_SET) {
    store[personaSet] = store[personaSet].slice(-MAX_ENTRIES_PER_SET);
  }

  saveStore(store);
}

/**
 * 過去フィードバックから繰り返し発生する問題点を取得
 * @param {string} personaSet
 * @returns {string} プロンプトに注入する改善指示（空文字なら問題なし）
 */
export function loadFeedbackHint(personaSet) {
  const store = loadStore();
  const entries = store[personaSet] ?? [];
  if (entries.length === 0) return '';

  // 最新3件のissueを集約
  const recent = entries.slice(-3);
  const badMap = {};
  for (const entry of recent) {
    for (const issue of entry.issues) {
      const key = issue.bad;
      badMap[key] = (badMap[key] ?? 0) + 1;
    }
  }

  // 2回以上出た問題のみ抽出（1回だけの問題はノイズ扱い）
  const recurring = Object.entries(badMap)
    .filter(([, count]) => count >= 2)
    .map(([bad]) => `・${bad}`);

  if (recurring.length === 0) return '';

  return `【過去レビューで繰り返し指摘された改善点（必ず対処すること）】\n${recurring.join('\n')}`;
}
