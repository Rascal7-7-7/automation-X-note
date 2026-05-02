/**
 * AI ニュース自動ツイート
 *
 * 最新AIニュース（OpenAI / Anthropic / Google / 中小AI）をRSSから取得し、
 * 感情込みの人間的ツイート＋記事URL＋OG画像で投稿。
 * 投稿後に関連noteリンクをリプライで自動付与。
 *
 * 使い方:
 *   node x/ai-news.js           # 1本投稿
 *   node x/ai-news.js --dry-run # 投稿せずプレビューのみ
 *   node x/ai-news.js --count 3 # 3本投稿
 */
import 'dotenv/config';
import https from 'https';
import http from 'http';
import { generate } from '../shared/claude-client.js';
import { postTweet, replyToTweet } from './post.js';
import { canPost } from '../shared/daily-limit.js';
import { appendFileSync, existsSync, readFileSync, readdirSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTED_LOG = path.join(__dirname, 'queue/ai-news-posted.jsonl');
mkdirSync(path.dirname(POSTED_LOG), { recursive: true });

// ── RSSソース ────────────────────────────────────────────────────────
const SOURCES = [
  { name: 'TechCrunch AI',  rss: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'The Verge AI',   rss: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'Wired AI',       rss: 'https://www.wired.com/feed/tag/ai/latest/rss' },
  { name: 'MIT Tech Review',rss: 'https://www.technologyreview.com/feed/' },
];

// ── AIキーワードフィルタ ─────────────────────────────────────────────
const AI_KEYWORDS = [
  'claude', 'chatgpt', 'gpt-', 'gemini', 'openai', 'anthropic', 'google ai',
  'deepmind', 'llm', 'large language model', 'mistral', 'llama', 'grok', 'meta ai',
  'copilot', 'ai agent', 'multimodal', 'o1', 'o3', 'o4', 'gpt-5', 'claude 4',
  'gemini 2', 'pricing', 'subscription', 'pro plan', 'free tier', 'api rate',
  'token limit', 'context window', 'new model', 'release', 'launch', 'perplexity',
  'cursor', 'windsurf', 'devin', 'sora', 'dall-e', 'stable diffusion', 'midjourney',
];

// ── 感情オープナーのバリエーション ──────────────────────────────────
// ツイート生成時にプロンプト内でランダム選択させる
const OPENERS = [
  'え、マジで！？',
  'ちょっと待って...',
  'これはヤバい',
  'まじか...',
  '正直びっくりした',
  'なんか複雑な気持ち',
  'これは熱い',
  '素直に嬉しい',
  'うーん、これどうなんだろ',
  'やばい、これ試したい',
  'さすがにキツいな',
  'なんか不安になってきた',
  '予想外だった',
  '待ってたやつ来た',
  'じわじわ怖い',
];

// ── note記事マッピング（関連リプライ用）───────────────────────────
const NOTE_ARTICLES = loadNoteArticles();

function loadNoteArticles() {
  const dirs = [
    path.join(__dirname, '../note/drafts'),
    path.join(__dirname, '../note/drafts/account2'),
    path.join(__dirname, '../note/drafts/account3'),
  ];
  const articles = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        if (d.noteUrl && d.status === 'posted') {
          articles.push({
            title: d.title || d.articleTitle || '',
            url: d.noteUrl,
            tags: (d.tags || []).map(t => t.toLowerCase()),
          });
        }
      } catch { /* skip */ }
    }
  }
  return articles;
}

function findRelevantNote(tweetText, articleTitle) {
  if (NOTE_ARTICLES.length === 0) return null;
  const text = `${tweetText} ${articleTitle}`.toLowerCase();
  let best = NOTE_ARTICLES[0];
  let bestScore = 0;
  for (const note of NOTE_ARTICLES) {
    const titleWords = note.title.toLowerCase().split(/\s+/);
    const tagScore = note.tags.filter(t => text.includes(t)).length * 2;
    const titleScore = titleWords.filter(w => w.length > 2 && text.includes(w)).length;
    const score = tagScore + titleScore;
    if (score > bestScore) { bestScore = score; best = note; }
  }
  return best;
}

// ── RSS フェッチ・パース ─────────────────────────────────────────────
function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': '*/*',
      },
      timeout: 15_000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        req.destroy();
        return resolve(fetchUrl(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseRSSItems(xml) {
  const items = [];
  const tagRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const b = m[1];
    const title = (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/.exec(b)?.[1] ??
                   /<title[^>]*>([^<]+)</.exec(b)?.[1] ?? '').trim()
                  .replace(/&#\d+;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const link  = (/<link[^>]+href=["']([^"']+)["']/.exec(b)?.[1] ??
                   /<link[^>]*>([^<]+)</.exec(b)?.[1] ??
                   /<guid[^>]*>([^<]+)</.exec(b)?.[1] ?? '').trim();
    const desc  = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/.exec(b)?.[1] ??
                   /<summary[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/.exec(b)?.[1] ??
                   /<description[^>]*>([^<]*)</.exec(b)?.[1] ??
                   /<summary[^>]*>([^<]*)</.exec(b)?.[1] ?? '')
                  .replace(/<[^>]+>/g, '').replace(/&[a-z#\d]+;/g, ' ').trim().slice(0, 400);
    if (title && link.startsWith('http')) items.push({ title, url: link, desc });
  }
  return items;
}

function isAIRelevant(item) {
  const text = `${item.title} ${item.desc}`.toLowerCase();
  return AI_KEYWORDS.some(kw => text.includes(kw));
}

function getPostedKeys() {
  if (!existsSync(POSTED_LOG)) return new Set();
  const keys = new Set();
  readFileSync(POSTED_LOG, 'utf8').trim().split('\n').filter(Boolean).forEach(l => {
    try {
      const d = JSON.parse(l);
      if (d.url)   keys.add(d.url);
      if (d.topic) keys.add(d.topic);
    } catch { /* skip */ }
  });
  return keys;
}

// ── daily-ai-trends / prompt-hints からトピック読み込み ──────────────
function loadDailyTopics() {
  const reportsDir = path.join(__dirname, '../analytics/reports');
  // 最新の daily-ai-trends-*.json を探す
  let topics = [];
  try {
    const files = readdirSync(reportsDir)
      .filter(f => f.startsWith('daily-ai-trends-') && f.endsWith('.json'))
      .sort().reverse();
    if (files.length > 0) {
      const d = JSON.parse(readFileSync(path.join(reportsDir, files[0]), 'utf8'));
      topics = (d.topicSuggestions ?? []).map(t => ({
        title:      t.topic,
        desc:       t.hook ?? '',
        url:        null,
        source:     `DailyResearch(${t.source ?? 'ai'})`,
        tweetDraft: t.tweetDraft ?? null,
        buzzScore:  t.buzzScore  ?? 5,
        topic:      t.topic,
      }));
    }
  } catch { /* skip if missing */ }

  // prompt-hints.json の todayTopics も補完（重複除去）
  try {
    const ph = JSON.parse(readFileSync(path.join(reportsDir, 'prompt-hints.json'), 'utf8'));
    const existing = new Set(topics.map(t => t.topic));
    for (const t of (ph.todayTopics ?? [])) {
      if (!existing.has(t.topic)) {
        topics.push({
          title: t.topic, desc: t.hook ?? '', url: null,
          source: 'PromptHints', tweetDraft: t.tweetDraft ?? null,
          buzzScore: t.buzzScore ?? 5, topic: t.topic,
        });
      }
    }
  } catch { /* skip */ }

  return topics.sort((a, b) => b.buzzScore - a.buzzScore);
}

// ── OG画像フェッチ ──────────────────────────────────────────────────
async function fetchOGImage(articleUrl) {
  try {
    const html = (await fetchUrl(articleUrl)).toString('utf8').slice(0, 30_000);
    const ogMatch = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/.exec(html)
                 ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/.exec(html);
    const imgUrl = ogMatch?.[1];
    if (!imgUrl || !imgUrl.startsWith('http')) return null;

    const imgBuf = await fetchUrl(imgUrl);
    const mime = imgUrl.includes('.jpg') || imgUrl.includes('.jpeg') ? 'image/jpeg' : 'image/png';
    console.log(`  OG image: ${imgUrl.slice(0, 70)} (${imgBuf.length} bytes)`);
    return { buffer: imgBuf, mime };
  } catch (err) {
    console.warn(`  OG image fetch failed: ${err.message.slice(0, 50)}`);
    return null;
  }
}

// ── ツイート生成 ─────────────────────────────────────────────────────
// URLはTwitterがt.co短縮するので23文字固定。本文は247文字以内に抑える。
const URL_TWITTER_CHARS = 23;
const MAX_BODY_CHARS = 270 - URL_TWITTER_CHARS - 1; // 246

const TWEET_SYSTEM = `あなたはAI副業・自動化に取り組むエンジニアです。AIニュースへの感情的なリアクションツイートを1本生成してください。

【必須ルール】
- ${MAX_BODY_CHARS}字以内（URLは別途追加するので本文のみ）
- 自分がAIとは一切明かさない（人間として自然に反応）
- 冒頭の感情表現は毎回バリエーションを変える。以下から文脈に合うものを選ぶ：
  「え、マジで！？」「ちょっと待って...」「これはヤバい」「まじか...」「正直びっくりした」
  「なんか複雑な気持ち」「これは熱い」「素直に嬉しい」「うーん、これどうなんだろ」
  「やばい、これ試したい」「さすがにキツいな」「なんか不安になってきた」「待ってたやつ来た」
  ※同じ開始表現の連続使用NG。ニュースのトーン（喜び・懸念・驚き）に合わせて選ぶこと
- ユーザー視点の具体的影響を書く（例：「Proプランで使えなくなったのか...試したかった人にはハードル上がるよなぁ」）
- ハッシュタグ1〜2個（#AI #Claude #ChatGPT など）
- 改行を適度に使って読みやすく
- 宣伝感ゼロ、口語体

【NG】
- 「〜です」「〜ます」で終わる硬い文体
- 「絶対」「必ず」の断定表現
- 過度な絵文字
- 「詳細はnoteで」などのCTA（別でリプライするので不要）`;

async function generateTweet(article) {
  const user = `以下のAIニュースについて感情的なリアクションツイートを1本生成してください。

ソース: ${article.source}
タイトル: ${article.title}
概要: ${article.desc || '（概要なし）'}

ツイート本文のみ出力（説明・前置き不要）。`;

  let text = await generate(TWEET_SYSTEM, user, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 500,
  });
  text = text.trim();

  if (text.length > MAX_BODY_CHARS) {
    text = await generate(TWEET_SYSTEM,
      `以下を${MAX_BODY_CHARS}字以内に短縮（感情・要点は維持）:\n\n${text}\n\n短縮後のみ出力。`,
      { model: 'claude-haiku-4-5-20251001', maxTokens: 400 }
    );
    text = text.trim();
  }

  // 末尾に記事URLを付与（Twitterが23文字にt.co短縮）
  return `${text}\n${article.url}`;
}

// ── メインロジック ───────────────────────────────────────────────────
export async function runAINews({ count = 1 } = {}) {
  await run({ dryRun: false, maxCount: count });
}

async function main() {
  const dryRun   = process.argv.includes('--dry-run');
  const countIdx = process.argv.indexOf('--count');
  const maxCount = countIdx >= 0 ? (Number(process.argv[countIdx + 1]) || 1) : 1;
  await run({ dryRun, maxCount });
}

async function run({ dryRun, maxCount }) {
  const postedKeys = getPostedKeys();
  let allItems = [];

  // ── RSS ─────────────────────────────────────────────────────────
  console.log('Fetching AI news from RSS...');
  const results = await Promise.allSettled(
    SOURCES.map(async (src) => {
      try {
        const xml = (await fetchUrl(src.rss)).toString('utf8');
        const items = parseRSSItems(xml).map(i => ({ ...i, source: src.name, buzzScore: 5 }));
        console.log(`  ${src.name}: ${items.length} items`);
        return items;
      } catch (err) {
        console.warn(`  ${src.name}: failed (${err.message.slice(0, 40)})`);
        return [];
      }
    })
  );
  for (const r of results) {
    if (r.status === 'fulfilled') allItems.push(...r.value);
  }

  // ── daily-ai-trends / prompt-hints トピック（高buzzScore優先）────
  const dailyTopics = loadDailyTopics().filter(t => !postedKeys.has(t.topic));
  console.log(`DailyTopics: ${dailyTopics.length} new topics (buzzScore≥5)`);

  // RSS フィルタ → buzzScore 付与してマージ → ソート
  const rssFiltered = allItems.filter(i => isAIRelevant(i) && !postedKeys.has(i.url));
  const merged = [...dailyTopics, ...rssFiltered]
    .sort((a, b) => (b.buzzScore ?? 5) - (a.buzzScore ?? 5));

  console.log(`\nTotal candidates: ${merged.length} (${dailyTopics.length} research + ${rssFiltered.length} RSS)`);

  if (merged.length === 0) {
    console.log('No new content to tweet.');
    return;
  }

  const targets = merged.slice(0, maxCount);

  for (let i = 0; i < targets.length; i++) {
    const article = targets[i];
    const isResearch = !!article.tweetDraft;
    console.log(`\n[${article.source}${isResearch ? ' ★' + article.buzzScore : ''}] ${article.title.slice(0, 80)}`);

    // research item: draft流用 / RSS item: LLM生成 + OG画像
    let tweetText, ogImage = null;
    if (isResearch) {
      tweetText = article.tweetDraft;
    } else {
      [tweetText, ogImage] = await Promise.all([
        generateTweet(article),
        fetchOGImage(article.url),
      ]);
    }

    console.log('\n' + '─'.repeat(50));
    console.log(tweetText);
    console.log('─'.repeat(50));
    const urlM = tweetText.match(/https?:\/\/\S+/g) ?? [];
    const twCount = tweetText.length - urlM.reduce((s, u) => s + u.length, 0) + urlM.length * 23;
    console.log(`Twitter換算: ${twCount}字 | 生: ${tweetText.length}字 | 画像: ${ogImage ? 'あり' : 'なし'}`);

    const relatedNote = findRelevantNote(tweetText, article.title);
    if (relatedNote) console.log(`  関連note: ${relatedNote.title.slice(0, 40)} → ${relatedNote.url}`);

    if (dryRun) {
      console.log('[DRY RUN] スキップ');
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 1_000));
      continue;
    }

    if (!canPost()) {
      console.log('[LIMIT] 日次上限到達。ai-news 投稿スキップ');
      break;
    }

    try {
      const result = await postTweet(
        tweetText,
        ogImage?.buffer ?? null,
        ogImage?.mime ?? 'image/jpeg'
      );
      const tweetId = result?.data?.id ?? result?.id;
      console.log(`✓ 投稿: ${tweetId}`);

      appendFileSync(POSTED_LOG, JSON.stringify({
        url:    article.url   ?? null,
        topic:  article.topic ?? null,
        title:  article.title,
        source: article.source,
        tweetId,
        postedAt: new Date().toISOString(),
      }) + '\n');

      if (tweetId && relatedNote) {
        await new Promise(r => setTimeout(r, 2_000));
        await replyToTweet(tweetId, `↓ 関連してnoteでも解説してます\n${relatedNote.url}`);
        console.log(`  ↩ リプライ送信: ${relatedNote.url}`);
      }
    } catch (err) {
      console.error(`✗ 投稿失敗: ${err.message}`);
    }

    if (i < targets.length - 1) await new Promise(r => setTimeout(r, 5_000));
  }
}

// 直接実行時のみ main() を呼ぶ
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
