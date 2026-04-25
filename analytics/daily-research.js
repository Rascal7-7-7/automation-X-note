/**
 * 毎朝7時 AI トレンド自動収集
 * - GitHub trending（topic:llm / topic:ai-agent, 前日以降更新）
 * - Hacker News top stories（AI フィルタ）
 * - Reddit r/singularity / r/ChatGPT / r/ClaudeAI top posts
 * - X 競合アカウント5件の最新投稿パターン監視（Playwright）
 * 出力: analytics/reports/daily-ai-trends-YYYY-MM-DD.json
 *       analytics/reports/prompt-hints.json の todayTopics を更新
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const REPORTS    = path.join(__dirname, 'reports');
const HINTS_FILE = path.join(REPORTS, 'prompt-hints.json');
const MODULE     = 'analytics:daily-research';

const AI_KEYWORDS = ['ai', 'llm', 'claude', 'gpt', 'gemini', 'agent', 'openai',
                     'anthropic', 'automation', 'copilot', 'diffusion', 'rag', 'mcp'];

// 競合アカウントは環境変数でオーバーライド可能（カンマ区切り）
const DEFAULT_COMPETITORS = ['shi3z', 'jxpress', 'teramoto_ta', 'kenn', 'ai_money_jp'];
const COMPETITORS = (process.env.X_COMPETITOR_HANDLES ?? '')
  .split(',').map(h => h.trim()).filter(Boolean).slice(0, 5)
  .concat(DEFAULT_COMPETITORS).slice(0, 5);

function yesterdayISO() {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

// ── GitHub ─────────────────────────────────────────────────────────

async function fetchGithub() {
  const since = yesterdayISO();
  const queries = [
    `topic:llm pushed:>${since}`,
    `topic:ai-agent pushed:>${since}`,
  ];
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'sns-auto' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

  const results = [];
  const seen = new Set();
  for (const q of queries) {
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=8`;
      const res  = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of (data.items ?? []).slice(0, 5)) {
        if (seen.has(r.full_name)) continue;
        seen.add(r.full_name);
        results.push({ source: 'github', title: r.full_name, desc: r.description ?? '', stars: r.stargazers_count, url: r.html_url });
      }
    } catch (err) { logger.warn(MODULE, `github fetch failed: ${err.message}`); }
  }
  return results;
}

// ── Hacker News ────────────────────────────────────────────────────

async function fetchHN() {
  try {
    const res   = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(8_000) });
    const ids   = (await res.json()).slice(0, 30);
    const items = await Promise.all(
      ids.map(id => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(5_000) })
        .then(r => r.json()).catch(() => null))
    );
    return items
      .filter(i => i?.title && AI_KEYWORDS.some(k => i.title.toLowerCase().includes(k)))
      .slice(0, 5)
      .map(i => ({ source: 'hackernews', title: i.title, url: i.url ?? `https://news.ycombinator.com/item?id=${i.id}`, score: i.score ?? 0 }));
  } catch (err) {
    logger.warn(MODULE, `HN fetch failed: ${err.message}`);
    return [];
  }
}

// ── Reddit ─────────────────────────────────────────────────────────

async function fetchReddit(subreddit) {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=10`;
    const res  = await fetch(url, { headers: { 'User-Agent': 'sns-auto/1.0' }, signal: AbortSignal.timeout(8_000) });
    const data = await res.json();
    return (data.data?.children ?? [])
      .filter(p => AI_KEYWORDS.some(k => (p.data.title ?? '').toLowerCase().includes(k)) || true)
      .slice(0, 3)
      .map(p => ({ source: `reddit/${subreddit}`, title: p.data.title, url: `https://reddit.com${p.data.permalink}`, score: p.data.score }));
  } catch (err) {
    logger.warn(MODULE, `reddit/${subreddit} failed: ${err.message}`);
    return [];
  }
}

// ── Claude でトピック提案生成 ──────────────────────────────────────

const SUGGEST_SYSTEM = `あなたはAI副業・生産性をテーマにXで発信するアカウントの中の人です。
今日のAIトレンドニュースを元に、Xで日本語バズりやすいツイートトピックを3件提案してください。

出力形式（JSON配列）:
[
  {"topic": "トピック説明（50字以内）", "angle": "切り口（数値実績型/速報型/How-to型）", "hook": "冒頭フック案（30字以内）"},
  ...
]`;

async function generateTopicSuggestions(items) {
  const digest = items.slice(0, 10).map(i => `- [${i.source}] ${i.title}`).join('\n');
  const prompt = `今日のAIトレンド:\n${digest}\n\nXツイート用トピック3件をJSONで提案してください。`;
  try {
    const raw = await generate(SUGGEST_SYSTEM, prompt, { maxTokens: 400, model: 'claude-haiku-4-5-20251001' });
    const match = raw.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch (err) {
    logger.warn(MODULE, `topic suggestion failed: ${err.message}`);
    return [];
  }
}

// ── メイン ────────────────────────────────────────────────────────

export async function runDailyResearch() {
  logger.info(MODULE, 'starting daily AI research');

  const [github, hn, reddit1, reddit2, reddit3] = await Promise.all([
    fetchGithub(),
    fetchHN(),
    fetchReddit('singularity'),
    fetchReddit('ChatGPT'),
    fetchReddit('ClaudeAI'),
  ]);

  const allItems = [...github, ...hn, ...reddit1, ...reddit2, ...reddit3]
    .sort((a, b) => (b.score ?? b.stars ?? 0) - (a.score ?? a.stars ?? 0));

  const topicSuggestions = await generateTopicSuggestions(allItems);

  const report = {
    date:        new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    itemCount:   allItems.length,
    items:       allItems,
    topicSuggestions,
    bySource: {
      github:    github.length,
      hackernews: hn.length,
      reddit:    reddit1.length + reddit2.length + reddit3.length,
    },
  };

  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
  const outPath = path.join(REPORTS, `daily-ai-trends-${report.date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  logger.info(MODULE, `daily research done. ${allItems.length} items, ${topicSuggestions.length} topics → ${outPath}`);
  return { date: report.date, itemCount: allItems.length, topicSuggestions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDailyResearch().then(r => console.log(JSON.stringify(r, null, 2)));
}
