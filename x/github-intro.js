/**
 * GitHub AI系トレンドリポジトリを紹介するX投稿
 * - GitHub Search API でスター数上位のAI系リポジトリを取得
 * - Claude でツイート文を生成（日本語・価値ある紹介文）
 * - xurl post / twitter-api-v2 で投稿
 * - 1日最大1件
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'x:github-intro';

const POSTED_LOG = path.join(__dirname, 'queue/github_posted.jsonl');
const DAILY_MAX  = 1;

// AI/ML系の検索クエリを交互に使う
const GITHUB_QUERIES = [
  'topic:llm stars:>500 pushed:>2026-01-01',
  'topic:ai-agent stars:>300 pushed:>2026-01-01',
  'topic:generative-ai stars:>300 pushed:>2026-01-01',
  'topic:mcp stars:>200 pushed:>2026-01-01',
  'topic:rag stars:>300 pushed:>2026-01-01',
];

const SYSTEM = `あなたはAI活用・副業・生産性をテーマに発信するXアカウントの中の人です。
GitHubのリポジトリを紹介するツイートを1件作成してください：
- 200〜240文字（日本語）
- 「何ができるのか」「なぜ使えるのか」「どんな人に役立つか」を簡潔に伝える
- 難しい技術用語は避け、AIツール初心者でも理解できる言葉を使う
- 最後にリポジトリURLを含める
- ハッシュタグ: #AI活用 #個人開発 のどちらか1つのみ
- 宣伝・自己PRは含めない
- 末尾に改行なし`;

// ── 投稿済み管理 ──────────────────────────────────────────────────

function loadPosted() {
  if (!fs.existsSync(POSTED_LOG)) return { repos: new Set(), todayCount: 0 };
  const today = new Date().toDateString();
  let todayCount = 0;
  const repos = new Set();
  const lines = fs.readFileSync(POSTED_LOG, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      repos.add(entry.fullName);
      if (entry.postedAt && new Date(entry.postedAt).toDateString() === today) todayCount++;
    } catch { /* skip */ }
  }
  return { repos, todayCount };
}

function recordPosted(repo, tweetId) {
  const entry = JSON.stringify({ fullName: repo.fullName, stars: repo.stars, tweetId, postedAt: new Date().toISOString() });
  fs.appendFileSync(POSTED_LOG, entry + '\n');
}

// ── GitHub Search API ─────────────────────────────────────────────

async function fetchTrendingRepos(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'sns-automation-bot',
  };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;

  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();

  return (data.items ?? []).map(r => ({
    fullName:    r.full_name,
    description: r.description ?? '',
    stars:       r.stargazers_count,
    url:         r.html_url,
    language:    r.language ?? '',
    topics:      r.topics ?? [],
  }));
}

// ── 今日のクエリを循環選択 ────────────────────────────────────────

function todayQuery() {
  const dayIndex = Math.floor(Date.now() / 86400000) % GITHUB_QUERIES.length;
  return GITHUB_QUERIES[dayIndex];
}

// ── xurl / twitter-api-v2 ─────────────────────────────────────────

let _xurlAvailable = null;
function isXurlAvailable() {
  if (_xurlAvailable === null) {
    try { execFileSync('xurl', ['--version'], { stdio: 'pipe' }); _xurlAvailable = true; }
    catch { _xurlAvailable = false; }
  }
  return _xurlAvailable;
}

async function postTweet(text) {
  if (isXurlAvailable()) {
    const raw = execFileSync('xurl', ['post', text], { encoding: 'utf8' });
    return JSON.parse(raw);
  }
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: process.env.X_API_KEY, appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
  });
  return client.v2.tweet(text);
}

// ── メイン ────────────────────────────────────────────────────────

export async function runGithubIntro(opts = {}) {
  const minStars = opts.minStars ?? 200;

  const { repos: postedRepos, todayCount } = loadPosted();
  if (todayCount >= DAILY_MAX) {
    logger.info(MODULE, `daily limit reached (${DAILY_MAX}/day), skipping`);
    return { posted: 0, reason: 'daily_limit' };
  }

  const query = opts.query ?? todayQuery();
  logger.info(MODULE, `GitHub search: "${query}"`);

  const repos = await fetchTrendingRepos(query);
  logger.info(MODULE, `${repos.length} repos found`);

  const candidates = repos.filter(r => !postedRepos.has(r.fullName) && r.stars >= minStars);
  if (candidates.length === 0) {
    logger.info(MODULE, 'no new candidates found');
    return { posted: 0, reason: 'no_candidates' };
  }

  const repo = candidates[0];
  logger.info(MODULE, `selected: ${repo.fullName} (${repo.stars} stars)`);

  const prompt = `以下のGitHubリポジトリを紹介するツイートを作成してください。

リポジトリ名: ${repo.fullName}
説明: ${repo.description}
スター数: ${repo.stars.toLocaleString()}
言語: ${repo.language}
トピック: ${repo.topics.slice(0, 5).join(', ')}
URL: ${repo.url}`;

  const tweetText = await generate(SYSTEM, prompt, { maxTokens: 350 });
  logger.info(MODULE, `tweet: ${tweetText}`);

  const result  = await postTweet(tweetText);
  const tweetId = result?.data?.id ?? result?.id;
  recordPosted(repo, tweetId);

  logger.info(MODULE, `posted tweet:${tweetId} for ${repo.fullName}`);
  return { posted: 1, repo: repo.fullName, stars: repo.stars, tweetId };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const query = process.argv[2] ?? undefined;
  runGithubIntro({ query });
}
