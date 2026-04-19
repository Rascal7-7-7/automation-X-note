/**
 * AI Tools 自動リサーチ（1日2回実行）
 * - GitHub / Reddit / Bluesky: 毎回
 * - X（Twitter）: 2日に1回（API上限考慮）
 * - 結果を Claude Sonnet で評価 → analytics/reports/ai-tools-YYYY-MM-DD-HH.md に保存
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from './claude-client.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, '../analytics/reports');
const STATE_PATH  = path.join(__dirname, '../analytics/ai-tools-state.json');
const MODULE = 'research:ai-tools';

const X_FETCH_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000; // 2日

const SEARCH_TERMS = [
  'MCP server claude',
  'model context protocol',
  'claude code plugin',
  'anthropic claude automation',
];

// ── 状態管理 ──────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { lastXFetch: 0 }; }
}

function saveState(state) {
  const dir = path.dirname(STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function shouldFetchX() {
  const { lastXFetch } = loadState();
  return Date.now() - lastXFetch >= X_FETCH_INTERVAL_MS;
}

// ── ソース別フェッチ ──────────────────────────────────────────────────

async function fetchGitHub() {
  try {
    const url = 'https://api.github.com/search/repositories?q=mcp+server+claude+topic:mcp&sort=updated&order=desc&per_page=10';
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'SNS-Automation-Bot' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? []).map(r => ({
      source: 'GitHub',
      name: r.full_name,
      description: r.description ?? '',
      stars: r.stargazers_count,
      updated: r.updated_at?.slice(0, 10) ?? '',
      url: r.html_url,
    }));
  } catch { return []; }
}

async function fetchNpm() {
  try {
    const res = await fetch(
      'https://registry.npmjs.org/-/v1/search?text=@modelcontextprotocol&size=10',
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.objects ?? []).map(o => ({
      source: 'npm',
      name: o.package.name,
      description: o.package.description ?? '',
      version: o.package.version,
      published: o.package.date?.slice(0, 10) ?? '',
    }));
  } catch { return []; }
}

async function fetchReddit() {
  const subreddits = [
    { sub: 'ClaudeAI',      q: 'MCP OR "model context" OR "Claude Code"' },
    { sub: 'LocalLLaMA',    q: 'MCP server' },
    { sub: 'MachineLearning', q: 'Claude MCP' },
  ];
  const results = [];
  for (const { sub, q } of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&sort=new&limit=5&restrict_sr=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SNS-Automation-Bot/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of data?.data?.children ?? []) {
        const post = p.data;
        results.push({
          source: `Reddit/r/${sub}`,
          title: post.title,
          score: post.score,
          url: `https://reddit.com${post.permalink}`,
          created: new Date(post.created_utc * 1000).toISOString().slice(0, 10),
        });
      }
    } catch { /* continue */ }
  }
  return results;
}

async function fetchBluesky() {
  try {
    const queries = ['claude MCP', 'anthropic', 'modelcontextprotocol'];
    const results = [];
    for (const q of queries) {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=5&sort=latest`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const post of data?.posts ?? []) {
        const text = post.record?.text ?? '';
        if (text.trim()) results.push({
          source: 'Bluesky',
          text: text.slice(0, 120),
          likeCount: post.likeCount ?? 0,
          author: post.author?.handle ?? '',
          created: post.indexedAt?.slice(0, 10) ?? '',
        });
      }
    }
    return results;
  } catch { return []; }
}

async function fetchX() {
  // Playwright 経由でブラウザ検索（API不使用）
  try {
    const { getXBrowser } = await import('../x/browser-client.js');
    const { browser, page } = await getXBrowser({ headless: true });
    const results = [];
    for (const term of SEARCH_TERMS.slice(0, 2)) {
      try {
        await page.goto(
          `https://x.com/search?q=${encodeURIComponent(term)}&f=live&src=typed_query`,
          { waitUntil: 'domcontentloaded', timeout: 20_000 }
        );
        // wait for timeline to render
        await page.waitForSelector('[data-testid="tweetText"], [data-testid="empty_state_header_text"]', { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(2_000);
        const tweets = await page.locator('[data-testid="tweetText"]').all();
        for (const tw of tweets.slice(0, 5)) {
          const text = (await tw.textContent()) ?? '';
          if (text.trim()) results.push({ source: 'X', text: text.slice(0, 120), term });
        }
      } catch { /* skip this term */ }
    }
    await browser.close();
    saveState({ ...loadState(), lastXFetch: Date.now() });
    return results;
  } catch {
    return [];
  }
}

// ── 評価 ──────────────────────────────────────────────────────────────

const PROJECT_CONTEXT = `SNS副業自動化システム（Node.js + Claude AI）:
- X/note/Instagram/Ghost/YouTube 自動投稿
- Claude Haiku/Sonnet/Opus でコンテンツ生成
- A8.net アフィリエイト自動同期（Playwright）
- n8n スケジューリング + Bridge Server（Express）
- 多視点ペルソナレビュー（5並列）
- PM2プロセス管理

既存: Playwright MCP / Claude Code CLI / xurl CLI`;

const EVAL_SYSTEM = `あなたはSNS副業自動化プロジェクトの技術選定アドバイザーです。
${PROJECT_CONTEXT}

収集した情報から、このプロジェクトに有益な新ツール・MCPを評価してください。

Markdown形式で出力:

## 注目ツール TOP3

### [ツール名]（出典: GitHub/npm/Reddit/Bluesky/X）
- **概要**: 1〜2行
- **適用場面**: このプロジェクトへの具体的な使い方
- **導入難易度**: 低/中/高
- **推奨**: 今すぐ試す / 様子見 / 不要

## 業界トレンド
2〜3行

## アクションアイテム
- [ ] アクション1
- [ ] アクション2`;

// ── メイン ─────────────────────────────────────────────────────────────

export async function runAIToolsResearch() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  logger.info(MODULE, 'starting research');

  const fetchX_ = shouldFetchX();
  logger.info(MODULE, `sources: github+npm+reddit+bluesky${fetchX_ ? '+X' : ' (X skip: <2days)'}`);

  const [githubItems, npmItems, redditItems, bskyItems, xItems] = await Promise.all([
    fetchGitHub(),
    fetchNpm(),
    fetchReddit(),
    fetchBluesky(),
    fetchX_ ? fetchX() : Promise.resolve([]),
  ]);

  const allItems = [...githubItems, ...npmItems, ...redditItems, ...bskyItems, ...xItems];
  logger.info(MODULE, `collected: github=${githubItems.length} npm=${npmItems.length} reddit=${redditItems.length} bluesky=${bskyItems.length} x=${xItems.length}`);

  if (allItems.length === 0) {
    logger.warn(MODULE, 'no data collected, skipping report');
    return null;
  }

  const dataText = allItems.map(item => {
    if (item.source === 'GitHub') return `[GitHub] ${item.name} ★${item.stars} (${item.updated}): ${item.description} — ${item.url}`;
    if (item.source === 'npm')    return `[npm] ${item.name} v${item.version} (${item.published}): ${item.description}`;
    if (item.source?.startsWith('Reddit')) return `[${item.source}] "${item.title}" ↑${item.score} ${item.url}`;
    if (item.source === 'Bluesky') return `[Bluesky @${item.author}] ${item.text}`;
    if (item.source === 'X')      return `[X "${item.term}"] ${item.text}`;
    return JSON.stringify(item);
  }).join('\n');

  const report = await generate(EVAL_SYSTEM, dataText, {
    model: 'claude-sonnet-4-6',
    maxTokens: 1200,
  });

  const now = new Date();
  const label = `${now.toISOString().slice(0, 10)}-${String(now.getUTCHours()).padStart(2, '0')}h`;
  const filename = `ai-tools-${label}.md`;
  const filePath = path.join(REPORTS_DIR, filename);

  fs.writeFileSync(filePath, `# AI Tools Research — ${label}\n\n${report}\n\n---\n*Sources: GitHub/npm/Reddit/Bluesky${fetchX_ ? '/X' : ''}*\n`);
  logger.info(MODULE, `saved: ${filename}`);

  return { filename, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAIToolsResearch()
    .then(r => { if (r) console.log('\n' + r.report); })
    .catch(err => { logger.error(MODULE, err.message); process.exit(1); });
}
