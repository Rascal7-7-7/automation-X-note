/**
 * YouTube 週次テーマ自動生成
 *
 * 毎週日曜に実行 → 翌週7日分のテーマを weekly_plan.json に追記する
 * - 既に登録済みの日付はスキップ
 * - トレンドを反映するため Claude に最新テーマを生成させる
 * - 水曜日はロング動画テーマも生成
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PLAN_FILE  = path.join(__dirname, 'queue/weekly_plan.json');
const MODULE     = 'youtube:plan';

const PLAN_SYSTEM = `あなたはYouTube副業・AI活用チャンネルのコンテンツプランナーです。
指定された日付リストに対してYouTubeショート動画のテーマを1つずつ生成してください。

【チャンネルコンセプト】
AIツール（Claude・ChatGPT等）を使って副業・自動化・収益化を実現する実践的な情報

【テーマ生成ルール】
- 具体的な数字を入れる（「月3万円」「10倍速」「3ステップ」等）
- 視聴者の悩みに直接答える形にする
- 「方法」「手順」「コツ」「理由」「違い」等の検索されやすいキーワードを末尾に
- 直近のAIトレンド（最新モデル・新機能）を1〜2個は含める
- 前週と同じテーマは避ける

【出力フォーマット】
YYYY-MM-DD: テーマ文（改行区切り、他の文字は一切不要）

例:
2026-04-20: ChatGPT o3で副業収益を2倍にした具体的手順
2026-04-21: Claudeの新機能で作業時間を半分にする方法`;

export async function runPlan() {
  const plan = loadPlan();

  // 今日から14日後までの未登録日を探す
  const missing = [];
  const today = new Date();
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0];
    if (!plan[key]) missing.push(key);
  }

  if (missing.length === 0) {
    logger.info(MODULE, 'all dates covered for next 14 days — skipping');
    return { added: 0 };
  }

  logger.info(MODULE, `generating themes for ${missing.length} missing dates`);

  const prompt = `以下の日付のYouTubeショートテーマを生成してください:\n${missing.join('\n')}`;
  const raw = await generate(PLAN_SYSTEM, prompt, { maxTokens: 1024, model: 'claude-sonnet-4-6' });

  let added = 0;
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+)/);
    if (!m) continue;
    const [, dateKey, theme] = m;
    if (!plan[dateKey]) {
      plan[dateKey] = { theme: theme.trim(), type: 'short' };
      // 水曜日はロング版も生成
      const dow = new Date(dateKey).getDay();
      if (dow === 3) {
        plan[dateKey + '_long'] = {
          theme: theme.trim().replace(/方法$/, '完全解説【保存版】').replace(/手順$/, '完全ガイド【保存版】') || theme + '【保存版】',
          type: 'long',
        };
      }
      added++;
    }
  }

  savePlan(plan);
  logger.info(MODULE, `plan updated: ${added} themes added`);
  return { added };
}

function loadPlan() {
  if (!fs.existsSync(PLAN_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePlan(plan) {
  // 日付順でソートして保存
  const sorted = Object.fromEntries(
    Object.entries(plan).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.mkdirSync(path.dirname(PLAN_FILE), { recursive: true });
  fs.writeFileSync(PLAN_FILE, JSON.stringify(sorted, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPlan().then(r => console.log('done:', r));
}
