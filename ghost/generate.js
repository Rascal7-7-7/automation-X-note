/**
 * Ghost英語記事生成モジュール
 * - ghost/queue/ideas.jsonl からテーマ取得（Redditコンテキスト付き）
 * - Claude Sonnet で outline → body の2段階生成（英語）
 * - Unsplash feature image URL 自動付与
 * - ghost/drafts/ に保存
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { FileQueue } from '../shared/queue.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'ghost:generate';
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const ideaQueue = new FileQueue(path.join(__dirname, 'queue/ideas.jsonl'));

// Unsplash curated photo IDs for AI/tech topics
const FEATURE_IMAGES = [
  'photo-1677442135703-1787eea5ce01', // AI abstract
  'photo-1620712943543-bcc4688e7485', // robot/AI
  'photo-1485827404703-89b55fcc595e', // automation robot
  'photo-1531746790731-6c087fecd65a', // tech abstract
  'photo-1518770660439-4636190af475', // circuit board
  'photo-1488229297570-58520851e868', // data/laptop
  'photo-1550751827-4bd374c3f58b', // cybersecurity
  'photo-1504868584819-f8e8b4b6d7e3', // charts/analytics
];

function getFeatureImage(tags = []) {
  const idx = Math.floor(Math.random() * FEATURE_IMAGES.length);
  return `https://images.unsplash.com/${FEATURE_IMAGES[idx]}?w=1200&q=80&fm=jpg&fit=crop`;
}

const OUTLINE_SYSTEM = `You are an expert English-language content writer targeting global audiences interested in AI, automation, and side income.

Given a topic (and optional Reddit/HN discussion context), return a JSON outline ONLY:
{
  "title": "Engaging title with numbers or power words",
  "summary": "2-sentence summary under 160 chars (SEO meta description)",
  "sections": ["Section 1", "Section 2", "Section 3", "Section 4", "Section 5"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "youtubeQuery": "YouTube search query for an embed (or null if not applicable)"
}

Title rules:
- Include a number (e.g. "5 Ways", "3 Tools", "in 30 Days")
- Power words: Ultimate, Proven, Beginner's, Step-by-Step, Real
- Focus: AI side hustle, automation income, Claude Code, Japan tech scene

Tags: 5 lowercase English keywords (no #).
youtubeQuery: if a YouTube tutorial/demo would add value, suggest a search query. Otherwise null.`;

function buildBodySystem(hasRedditContext) {
  return `You are an expert English content writer for a Ghost blog (rascal.ghost.io) targeting global readers interested in AI automation and side income.

Write a 1500-2000 word article in HTML based on the outline.${hasRedditContext ? '\nThe article should reference real online discussions and community sentiment where relevant.' : ''}

Rules:
- Start directly with content (no <html>/<body> tags)
- Use <h2> for sections, <h3> for sub-headings
- Use <p>, <ul>/<li>, <strong> for emphasis
- Include concrete numbers, examples, actionable steps
- First-person voice where natural ("I automated...", "In my experience...")
- If a YouTube embed URL is provided, insert it as: <figure class="kg-card kg-embed-card"><iframe width="560" height="315" src="YOUTUBE_EMBED_URL" frameborder="0" allowfullscreen></iframe></figure>
- End with a strong call-to-action paragraph
- Do NOT wrap in markdown code blocks`;
}

async function findYouTubeEmbed(query) {
  if (!query) return null;
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return match ? `https://www.youtube.com/embed/${match[1]}` : null;
  } catch {
    return null;
  }
}

export async function runGenerate(opts = {}) {
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  const idea = await ideaQueue.shift();
  const topic = idea?.topic ?? 'How I automated my social media income with Claude AI';
  const redditContext = idea?.redditContext ?? '';
  const sourceUrl = idea?.sourceUrl ?? null;
  const sourcePlatform = idea?.sourcePlatform ?? null;

  logger.info(MODULE, `generating: ${topic.slice(0, 70)}`);

  // Stage 1: Outline
  const topicPrompt = redditContext
    ? `Topic: ${topic}\n\nCommunity discussion context:\n${redditContext}\n${sourceUrl ? `Source: ${sourceUrl}` : ''}`
    : `Topic: ${topic}`;

  const outlineRaw = await generate(OUTLINE_SYSTEM, topicPrompt, { model: 'claude-sonnet-4-6' });
  let outline;
  try {
    outline = JSON.parse(outlineRaw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    throw new Error(`outline parse failed: ${outlineRaw.slice(0, 200)}`);
  }
  logger.info(MODULE, `outline: ${outline.title}`);

  // Find YouTube embed if suggested
  const youtubeEmbedUrl = await findYouTubeEmbed(outline.youtubeQuery);
  if (youtubeEmbedUrl) logger.info(MODULE, `youtube embed: ${youtubeEmbedUrl}`);

  // Stage 2: Body
  const sectionList = outline.sections.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const bodyPrompt = [
    `Title: ${outline.title}`,
    `Summary: ${outline.summary}`,
    `\nSections:\n${sectionList}`,
    redditContext ? `\nReddit/community context to weave in:\n${redditContext}` : '',
    youtubeEmbedUrl ? `\nEmbed this YouTube video in a relevant section: ${youtubeEmbedUrl}` : '',
    sourceUrl ? `\nYou may reference this discussion: ${sourceUrl}` : '',
    '\nWrite the full article now.',
  ].filter(Boolean).join('\n');

  const html = await generate(buildBodySystem(!!redditContext), bodyPrompt, {
    model: 'claude-sonnet-4-6',
    maxTokens: 4000,
  });

  const draft = {
    title: outline.title,
    summary: outline.summary,
    html: html.replace(/```html?\n?/g, '').replace(/```/g, '').trim(),
    tags: outline.tags,
    excerpt: outline.summary,
    featureImage: getFeatureImage(outline.tags),
    status: 'draft',
    createdAt: new Date().toISOString(),
    sourceTopic: topic,
    sourceType: sourcePlatform ? 'reddit' : 'original',
    sourceUrl,
    youtubeEmbed: youtubeEmbedUrl,
  };

  const slug = outline.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50);
  const filename = `${Date.now()}-${slug}.json`;
  const filePath = path.join(DRAFTS_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(draft, null, 2));
  logger.info(MODULE, `saved: ${filename}`);

  return draft;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runGenerate().catch(err => { logger.error(MODULE, err.message); process.exit(1); });
}
