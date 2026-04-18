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

// ── シリーズ設計 ────────────────────────────────────────────────────
// 5シリーズをローテーション。アルゴリズムがチャンネルを「専門アカウント」と認識する
const SERIES_ROTATION = [
  { name: 'AI違和感シリーズ', template: 5, desc: 'AIが作った世界の違和感を発見するシリーズ' },
  { name: 'AI崩壊シリーズ',   template: 1, desc: 'AIで作った現実がどこかで崩れるシリーズ' },
  { name: 'AI vs 現実シリーズ', template: 2, desc: 'AIと現実どっちか当てるシリーズ' },
  { name: 'AI裏側シリーズ',   template: 3, desc: 'AIコンテンツの作り方を公開するシリーズ' },
  { name: 'AI進化シリーズ',   template: 4, desc: '去年のAIと今のAIを比較するシリーズ' },
];

// 曜日別AIツール固定 — 毎週同じ曜日に同じツールで「専門性」を演出
const AI_TOOLS_BY_DOW = [
  'Runway Gen-4',      // 日
  'Stable Diffusion',  // 月
  'Midjourney',        // 火
  'Gemini Imagen',     // 水
  'Sora',              // 木
  'Kling AI',          // 金
  'Claude',            // 土
];

const PLAN_SYSTEM = `あなたはYouTube AIコンテンツチャンネルのプランナーです。
アカウントコンセプト:「AIでここまでできる」を体験させる。違和感×AI価値×フォロー獲得。

指定された日付・シリーズ・AIツール・テンプレートに合わせてテーマを生成してください。

【入力フォーマット】
YYYY-MM-DD | シリーズ名 | AIツール名 | テンプレート番号

【テーマ生成ルール】
- シリーズ名を活かしたテーマにする（例:「AI崩壊シリーズ」なら崩壊・消滅系のテーマ）
- AIツール名を自然に含める（例:「Runwayで作った映像が崩壊した瞬間」）
- 具体的な数字か意外性を入れる
- 「方法」「瞬間」「比較」「違い」「限界」等の検索キーワードを末尾に
- 直近のAIトレンドを意識する

【出力フォーマット（厳守）】
YYYY-MM-DD: テーマ文（1行1テーマ、他の文字不要）

例:
2026-04-20: RunwayのAI映像、最後に崩壊する瞬間を見てください
2026-04-21: Stable DiffusionのAIと現実、どっちか当ててみて`;

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

  // シリーズ別エピソード数を集計（既存プランから）
  const episodeCounts = {};
  for (const entry of Object.values(plan)) {
    if (entry.series) {
      episodeCounts[entry.series] = (episodeCounts[entry.series] ?? 0) + 1;
    }
  }

  // 各日付のメタ情報を決定してからClaudeにテーマ生成依頼
  const missingMeta = missing.map((dateKey, i) => {
    const dow = new Date(dateKey).getDay();
    // シリーズは全体の連番インデックスでローテーション
    const totalShorts = Object.values(plan).filter(e => e.type === 'short').length;
    const series = SERIES_ROTATION[(totalShorts + i) % SERIES_ROTATION.length];
    const aiTool = AI_TOOLS_BY_DOW[dow];
    return { dateKey, series, aiTool };
  });

  const promptLines = missingMeta
    .map(({ dateKey, series, aiTool }) =>
      `${dateKey} | ${series.name} | ${aiTool} | テンプレート${series.template}`)
    .join('\n');

  const raw = await generate(PLAN_SYSTEM, `以下の日付のYouTubeショートテーマを生成:\n${promptLines}`, {
    maxTokens: 1024,
    model: 'claude-sonnet-4-6',
  });

  let added = 0;
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+)/);
    if (!m) continue;
    const [, dateKey, theme] = m;
    if (plan[dateKey]) continue;

    const meta = missingMeta.find(x => x.dateKey === dateKey);
    if (!meta) continue;

    episodeCounts[meta.series.name] = (episodeCounts[meta.series.name] ?? 0) + 1;

    plan[dateKey] = {
      theme: theme.trim(),
      type: 'short',
      series: meta.series.name,
      episode: episodeCounts[meta.series.name],
      template: meta.series.template,
      aiTool: meta.aiTool,
    };

    // 水曜日はロング版も生成
    if (new Date(dateKey).getDay() === 3) {
      plan[dateKey + '_long'] = {
        theme: theme.trim()
          .replace(/方法$/, '完全解説【保存版】')
          .replace(/手順$/, '完全ガイド【保存版】')
          .replace(/瞬間$/, '全記録【保存版】') || `${theme.trim()}【保存版】`,
        type: 'long',
        series: meta.series.name,
        episode: episodeCounts[meta.series.name],
        aiTool: meta.aiTool,
      };
    }
    added++;
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
