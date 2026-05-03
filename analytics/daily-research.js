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
import { saveJSON } from '../shared/file-utils.js';
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
      .filter(p => AI_KEYWORDS.some(k => (p.data.title ?? '').toLowerCase().includes(k)))
      .slice(0, 3)
      .map(p => ({ source: `reddit/${subreddit}`, title: p.data.title, url: `https://reddit.com${p.data.permalink}`, score: p.data.score }));
  } catch (err) {
    logger.warn(MODULE, `reddit/${subreddit} failed: ${err.message}`);
    return [];
  }
}

// ── X 競合アカウント監視 (Playwright) ────────────────────────────────

async function fetchXCompetitors() {
  const results = [];
  let browser;
  try {
    const { getXBrowser } = await import('../x/browser-client.js');
    const bCtx = await getXBrowser({ headless: true });
    browser = bCtx.browser;
    const { page } = bCtx;

    for (const handle of COMPETITORS) {
      try {
        await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await page.waitForSelector('[data-testid="tweetText"]', { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1_500);

        const tweetEls = await page.locator('[data-testid="tweetText"]').all();
        const posts = [];
        for (const el of tweetEls.slice(0, 3)) {
          const text = (await el.textContent().catch(() => '')) ?? '';
          if (text.trim().length > 10) posts.push(text.trim().slice(0, 200));
        }
        if (posts.length > 0) {
          results.push({ source: `x/@${handle}`, handle, posts });
          logger.info(MODULE, `@${handle}: ${posts.length} posts captured`);
        }
      } catch (err) {
        logger.warn(MODULE, `@${handle} skipped — ${err.message}`);
      }
    }

  } catch (err) {
    logger.warn(MODULE, `x competitor fetch skipped — ${err.message}`);
  } finally {
    await browser?.close().catch(() => {});
  }
  return results;
}

// ── Claude Haiku でトピック提案生成 ──────────────────────────────────

const SUGGEST_SYSTEM = `あなたはAI副業・自動化をテーマにXで発信する日本語アカウントの担当者です。
今日の海外AIトレンドを日本語副業層に刺さるXツイートトピックに変換してください。

必ずJSON配列のみを出力してください（説明文・マークダウン不要）:
[
  {
    "topic": "テーマ（40字以内）",
    "angle": "数値実績型",
    "hook": "冒頭フック（30字以内）",
    "tweetDraft": "ツイート草稿（270字以内・日本語・note誘導CTA付き）",
    "buzzScore": 8,
    "source": "github"
  }
]

3件出力。選定基準: 副業層が保存・RTしたい内容、数字・比較・実績を含む。`;

async function generateTopicSuggestions(allItems, competitors) {
  const lines = [];

  lines.push('## GitHub Trending');
  for (const i of allItems.filter(i => i.source === 'github').slice(0, 6)) {
    lines.push(`- ${i.title} ★${i.stars}: ${i.desc}`);
  }
  lines.push('\n## Hacker News TOP');
  for (const i of allItems.filter(i => i.source === 'hackernews').slice(0, 6)) {
    lines.push(`- "${i.title}" ↑${i.score}`);
  }
  lines.push('\n## Reddit day top');
  for (const i of allItems.filter(i => i.source.startsWith('reddit')).slice(0, 6)) {
    lines.push(`- [${i.source}] "${i.title}" ↑${i.score}`);
  }
  if (competitors.length > 0) {
    lines.push('\n## X 競合アカウント最新投稿');
    for (const c of competitors) {
      lines.push(`@${c.handle}:`);
      for (const p of c.posts) lines.push(`  "${p}"`);
    }
  }

  try {
    const raw = await generate(SUGGEST_SYSTEM, lines.join('\n'), {
      maxTokens: 1000,
      model: 'claude-haiku-4-5-20251001',
    });
    // handle both bare array and ```json ... ``` wrapping
    const match = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/) ?? raw.match(/(\[[\s\S]*\])/);
    if (!match) {
      logger.warn(MODULE, `raw haiku response: ${raw.slice(0, 200)}`);
      throw new Error('no JSON array in response');
    }
    return JSON.parse(match[1]).slice(0, 3);
  } catch (err) {
    logger.warn(MODULE, `topic suggestion failed: ${err.message}`);
    return [];
  }
}

// ── prompt-hints.json に todayTopics を書き込む ────────────────────

function updatePromptHints(topics) {
  let hints = {};
  try { hints = JSON.parse(fs.readFileSync(HINTS_FILE, 'utf8')); } catch { /* first run */ }
  hints.todayTopics = topics.map(t => ({
    topic: t.topic, angle: t.angle, hook: t.hook,
    tweetDraft: t.tweetDraft, buzzScore: t.buzzScore,
  }));
  hints.todayTopicsUpdatedAt = new Date().toISOString();
  saveJSON(HINTS_FILE, hints);
}

// ── メイン ────────────────────────────────────────────────────────

export async function runDailyResearch() {
  logger.info(MODULE, 'starting daily AI research');
  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });

  const [github, hn, reddit1, reddit2, reddit3, competitors] = await Promise.all([
    fetchGithub(),
    fetchHN(),
    fetchReddit('singularity'),
    fetchReddit('ChatGPT'),
    fetchReddit('ClaudeAI'),
    fetchXCompetitors(),
  ]);

  const allItems = [...github, ...hn, ...reddit1, ...reddit2, ...reddit3]
    .sort((a, b) => (b.score ?? b.stars ?? 0) - (a.score ?? a.stars ?? 0));

  logger.info(MODULE,
    `collected: github=${github.length} hn=${hn.length} reddit=${reddit1.length + reddit2.length + reddit3.length} competitors=${competitors.length}`
  );

  const topicSuggestions = await generateTopicSuggestions(allItems, competitors);

  const report = {
    date:        new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    competitors: COMPETITORS,
    itemCount:   allItems.length,
    items:       allItems,
    xCompetitors: competitors,
    topicSuggestions,
    bySource: {
      github:     github.length,
      hackernews: hn.length,
      reddit:     reddit1.length + reddit2.length + reddit3.length,
      xCompetitors: competitors.length,
    },
  };

  const filename = `daily-ai-trends-${report.date}.json`;
  saveJSON(path.join(REPORTS, filename), report);

  updatePromptHints(topicSuggestions);

  logger.info(MODULE, `done: ${allItems.length} items, ${topicSuggestions.length} topics → ${filename}`);
  return { date: report.date, itemCount: allItems.length, topicSuggestions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDailyResearch().then(r => console.log(JSON.stringify(r, null, 2)));
}
