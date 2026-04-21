/**
 * GitHub AI系トレンドリポジトリを紹介するX投稿
 * - GitHub Search API でスター数上位のAI系リポジトリを取得
 * - Claude でツイート文を生成（日本語・価値ある紹介文）
 * - xurl post / twitter-api-v2 で投稿
 * - 1日最大1件
 */
import 'dotenv/config';
import { generate } from '../shared/claude-client.js';
import { postTweet } from './pipeline.js';
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
GitHubのリポジトリを紹介するツイートを1件作成してください。

【フォーマット（必須）】
1行目: 「🔧 [ツール名] — [一言キャッチ]」（絵文字で始める）
空行
「何ができるか」を箇条書き（✅ ×3行、各行15字以内）
空行
「どんな人に使える？」1行
空行
リポジトリURL（末尾）
空行
ハッシュタグ関連性があれば4個まで（#AI活用 #個人開発 #Claude #GitHub 等）

【ルール】
- 合計200〜250文字
- 改行を7〜9回使う（スクロール停止・可読性最大化）
- 技術用語は避け、初心者でも分かる言葉
- 「スター数○○件」は書かない
- 宣伝・自己PRは含めない`;

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

  const tweetId = await postTweet(tweetText);
  recordPosted(repo, tweetId);

  logger.info(MODULE, `posted tweet:${tweetId} for ${repo.fullName}`);
  return { posted: 1, repo: repo.fullName, stars: repo.stars, tweetId };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const query = process.argv[2] ?? undefined;
  runGithubIntro({ query });
}
