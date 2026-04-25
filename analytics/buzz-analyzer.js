/**
 * バズ分析 & プロンプトヒント生成
 *
 * 入力: logs/analytics/x-posts.jsonl + performance.jsonl
 * 出力:
 *   analytics/reports/x-summary.json
 *   analytics/reports/note-summary.json
 *   analytics/reports/prompt-hints.json  ← generate.js / pipeline.js が参照
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readLog } from './logger.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, 'reports');
const MODULE = 'analytics:buzz';

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function writeReport(filename, data) {
  const tmp = path.join(REPORTS_DIR, filename + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, path.join(REPORTS_DIR, filename));
}

// ── X分析 ──────────────────────────────────────────────────────────
function analyzeX(posts, perf) {
  // performance を tweetId でインデックス化
  const perfMap = {};
  for (const p of perf.filter(p => p.targetType === 'x')) {
    if (!perfMap[p.targetId] || p.fetchedAt > perfMap[p.targetId].fetchedAt) {
      perfMap[p.targetId] = p;
    }
  }

  // メトリクスが取れた投稿だけ分析対象
  const enriched = posts
    .filter(p => p.tweetId && perfMap[p.tweetId])
    .map(p => ({
      ...p,
      likes:       perfMap[p.tweetId].likes       ?? 0,
      reposts:     perfMap[p.tweetId].reposts      ?? 0,
      impressions: perfMap[p.tweetId].impressions  ?? 0,
      hour:        new Date(p.createdAt).getHours(),
      textLen:     p.text?.length ?? 0,
      hashtagCount: (p.text?.match(/#\S+/g) ?? []).length,
    }));

  if (enriched.length === 0) {
    return { note: 'not enough data yet (need performance metrics)' };
  }

  // キーワード別平均 likes
  const byKeyword = groupBy(enriched, 'keyword');
  const topKeywords = Object.entries(byKeyword)
    .map(([kw, items]) => ({ keyword: kw, avgLikes: avg(items, 'likes') }))
    .sort((a, b) => b.avgLikes - a.avgLikes)
    .slice(0, 5)
    .map(k => k.keyword);

  // 投稿時間帯別
  const byHour = groupBy(enriched, 'hour');
  const bestPostHours = Object.entries(byHour)
    .map(([h, items]) => ({ hour: Number(h), avgLikes: avg(items, 'likes') }))
    .sort((a, b) => b.avgLikes - a.avgLikes)
    .slice(0, 3)
    .map(h => h.hour);

  // promo vs normal 比較
  const promoItems  = enriched.filter(p => p.type === 'promo');
  const normalItems = enriched.filter(p => p.type === 'normal');
  const promoAvg  = promoItems.length  ? avg(promoItems, 'likes')  : null;
  const normalAvg = normalItems.length ? avg(normalItems, 'likes') : null;

  // 有効パターン（likes > 平均）
  const avgAll = avg(enriched, 'likes');
  const effective = enriched.filter(p => p.likes >= avgAll);
  const weak      = enriched.filter(p => p.likes < avgAll / 2);

  return {
    sampleSize: enriched.length,
    topKeywords,
    bestPostHours,
    promoVsNormal: { promoAvg, normalAvg },
    effectivePatterns: summarizePatterns(effective),
    weakPatterns:      summarizePatterns(weak),
  };
}

// ── note分析 ──────────────────────────────────────────────────────
function analyzeNote(notePosts, perf) {
  const perfMap = {};
  for (const p of perf.filter(p => p.targetType === 'note')) {
    if (!perfMap[p.targetId] || p.fetchedAt > perfMap[p.targetId].fetchedAt) {
      perfMap[p.targetId] = p;
    }
  }

  // Build a lookup from draftPath → draft record (which has title/theme)
  const draftByPath = {};
  for (const d of notePosts.filter(p => p.draftPath)) {
    if (!draftByPath[d.draftPath] || d.title) draftByPath[d.draftPath] = d;
  }

  const posted = notePosts
    .filter(p => p.status === 'posted' && p.noteUrl)
    .map(p => {
      const draftData = p.draftPath ? draftByPath[p.draftPath] : null;
      // fall back to reading the draft JSON file from disk
      let diskData = null;
      if (p.draftPath && ((!p.title && !draftData?.title) || (!p.theme && !draftData?.theme))) {
        const diskPath = p.draftPath.replace(/^\/home\/[^/]+\//, `${process.env.HOME}/`);
        try { diskData = JSON.parse(fs.readFileSync(diskPath, 'utf8')); } catch { /* missing */ }
      }
      return {
        ...p,
        title: p.title ?? draftData?.title ?? diskData?.title ?? null,
        theme: p.theme ?? draftData?.theme ?? diskData?.theme ?? null,
      };
    });

  if (posted.length === 0) {
    return { note: 'not enough posted articles yet' };
  }

  const hasNumbers = (title) => /[0-9０-９]/.test(title);

  const withNumbers    = posted.filter(p => hasNumbers(p.title));
  const withoutNumbers = posted.filter(p => !hasNumbers(p.title));

  const themeCount = posted.reduce((acc, p) => {
    const key = p.theme ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    sampleSize:          posted.length,
    avgTitleLength:      Math.round(avg(posted, p => p.title?.length ?? 0)),
    titlesWithNumbers:   withNumbers.length,
    titlesWithoutNumbers: withoutNumbers.length,
    topThemes:           themeCount,
  };
}

// ── プロンプトヒント生成 ───────────────────────────────────────────
function buildPromptHints(xSummary, noteSummary) {
  const hints = {
    topKeywords:      xSummary.topKeywords      ?? [],
    bestPostHours:    xSummary.bestPostHours     ?? [8, 12, 18],
    effectivePatterns: xSummary.effectivePatterns ?? [],
    weakPatterns:      xSummary.weakPatterns      ?? [],
    noteInsights: {
      preferNumbersInTitle: (noteSummary.titlesWithNumbers ?? 0)
        > (noteSummary.titlesWithoutNumbers ?? 0),
      avgTitleLength: noteSummary.avgTitleLength ?? 20,
    },
    updatedAt: new Date().toISOString(),
  };
  return hints;
}

// ── ヘルパー ──────────────────────────────────────────────────────
function groupBy(arr, keyOrFn) {
  return arr.reduce((acc, item) => {
    const key = typeof keyOrFn === 'function' ? keyOrFn(item) : item[keyOrFn];
    if (key == null) return acc;
    (acc[key] = acc[key] ?? []).push(item);
    return acc;
  }, {});
}

function avg(arr, keyOrFn) {
  if (arr.length === 0) return 0;
  const vals = arr.map(i => typeof keyOrFn === 'function' ? keyOrFn(i) : i[keyOrFn] ?? 0);
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function summarizePatterns(items) {
  const patterns = [];
  const numericTitles = items.filter(i => /[0-9]/.test(i.text ?? ''));
  if (numericTitles.length > items.length / 2) {
    patterns.push('数字を含む投稿が反応を取りやすい');
  }
  const short = items.filter(i => (i.textLen ?? 0) <= 100);
  if (short.length > items.length / 2) {
    patterns.push('100文字以内の簡潔な投稿が効果的');
  }
  const fewHashtags = items.filter(i => (i.hashtagCount ?? 0) <= 2);
  if (fewHashtags.length > items.length * 0.6) {
    patterns.push('ハッシュタグ2個以下が好まれる傾向');
  }
  return patterns;
}

// ── メイン ────────────────────────────────────────────────────────
export async function runBuzzAnalysis() {
  logger.info(MODULE, 'analysis start');

  const xPosts   = readLog('x-posts.jsonl');
  const notePosts = readLog('note-posts.jsonl');
  const perf     = readLog('performance.jsonl');

  const xSummary    = analyzeX(xPosts, perf);
  const noteSummary = analyzeNote(notePosts, perf);
  const hints       = buildPromptHints(xSummary, noteSummary);

  writeReport('x-summary.json',    xSummary);
  writeReport('note-summary.json', noteSummary);
  writeReport('prompt-hints.json', hints);

  logger.info(MODULE, 'reports written', {
    x: Object.keys(xSummary).join(', '),
    note: Object.keys(noteSummary).join(', '),
  });

  return { xSummary, noteSummary, hints };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBuzzAnalysis();
}
