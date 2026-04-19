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
import { generateWithReview } from '../shared/multi-persona-reviewer.js';
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

const CAMPAIGNS_PATH = path.join(__dirname, 'asp-campaigns.json');
function loadActiveCampaigns() {
  try {
    const data = JSON.parse(fs.readFileSync(CAMPAIGNS_PATH, 'utf8'));
    return (data.campaigns ?? []).filter(c => c.active && c.affiliateUrl);
  } catch { return []; }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function insertAffiliateLinks(html, campaigns) {
  if (!campaigns.length) return html;
  let result = html;
  for (const campaign of campaigns) {
    const pattern = campaign.keywords.map(escapeRegex).join('|');
    if (!new RegExp(pattern, 'i').test(result)) continue;
    const ctaBlock = `\n<div style="background:#f8f9ff;border:1px solid #e0e4ff;border-left:4px solid #4F46E5;padding:16px 20px;margin:24px 0;border-radius:6px"><p style="margin:0 0 8px;font-weight:bold;font-size:14px">Recommended Tool</p><p style="margin:0 0 12px;font-size:14px;color:#444">${campaign.description}</p><a href="${campaign.affiliateUrl}" style="display:inline-block;background:#4F46E5;color:white;padding:8px 20px;border-radius:4px;font-weight:bold;font-size:14px;text-decoration:none">${campaign.ctaText}</a></div>\n`;
    const paraMatch = result.match(new RegExp(`(<p[^>]*>[^<]*(?:${pattern})[^<]*<\\/p>)`, 'i'));
    if (paraMatch) {
      result = result.replace(paraMatch[0], paraMatch[0] + ctaBlock);
    } else {
      result = result.replace(/(<h2[^>]*>[^<]*FAQ)/i, ctaBlock + '$1');
    }
  }
  return result;
}

const OUTLINE_SYSTEM = `You are an expert SEO content strategist targeting English-speaking audiences interested in AI, automation, and side income.

Given a topic (and optional Reddit/HN context), return a JSON outline ONLY:
{
  "title": "SEO-optimized title with primary keyword near the start",
  "summary": "Meta description: 150-160 chars, include primary keyword, clear value proposition",
  "primaryKeyword": "main SEO keyword phrase (3-5 words)",
  "sections": ["Keyword-rich H2 1", "Keyword-rich H2 2", "Keyword-rich H2 3", "Keyword-rich H2 4", "FAQ: Top Questions About [topic]"],
  "faqQuestions": ["Question 1?", "Question 2?", "Question 3?"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "youtubeQuery": "YouTube search query for tutorial embed (or null)"
}

Title rules:
- Primary keyword in first 60 chars
- Include number OR "How to" OR "Guide" OR "Best"
- Power words: Ultimate, Proven, Complete, Step-by-Step, 2026
- Focus: AI tools, automation income, Claude Code, side hustle

sections[4] MUST be an FAQ section title.
faqQuestions: 3 questions real users search for about this topic.
Tags: 5 lowercase English SEO keywords.`;

function buildBodySystem(hasRedditContext) {
  return `You are an expert SEO content writer for Rascal.AI (rascal.ghost.io), targeting global readers interested in AI automation and side income.

Write a 2000-2500 word article in HTML based on the outline.${hasRedditContext ? '\nWeave in real online community sentiment and discussion where relevant.' : ''}

SEO rules:
- Use primary keyword in the first paragraph and naturally throughout
- <h2> tags must contain keywords (not generic "Introduction")
- Add <h3> sub-headings within each section
- Use <strong> for key terms on first use
- Include at least one data point or statistic per section

Structure rules:
- Start with a compelling hook paragraph (no heading)
- Use <h2> for main sections, <h3> for sub-headings
- Use <p>, <ul>/<li>, <strong> for formatting
- If YouTube embed URL provided: <figure class="kg-card kg-embed-card"><iframe width="560" height="315" src="EMBED_URL" frameborder="0" allowfullscreen></iframe></figure>
- Final section MUST be FAQ formatted as:
  <h2>FAQ: [Topic] — Your Questions Answered</h2>
  <h3>Question 1?</h3><p>Answer...</p>
  <h3>Question 2?</h3><p>Answer...</p>
  <h3>Question 3?</h3><p>Answer...</p>
- End with CTA: "Subscribe to Rascal.AI newsletter for weekly AI automation strategies."
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
  const faqList = (outline.faqQuestions ?? []).map((q, i) => `  Q${i + 1}: ${q}`).join('\n');
  const bodyPrompt = [
    `Title: ${outline.title}`,
    `Primary keyword: ${outline.primaryKeyword ?? ''}`,
    `Summary: ${outline.summary}`,
    `\nSections:\n${sectionList}`,
    faqList ? `\nFAQ questions to answer:\n${faqList}` : '',
    redditContext ? `\nCommunity context to weave in:\n${redditContext}` : '',
    youtubeEmbedUrl ? `\nEmbed this YouTube video in a relevant section: ${youtubeEmbedUrl}` : '',
    sourceUrl ? `\nYou may reference this discussion: ${sourceUrl}` : '',
    '\nWrite the full 2000-2500 word article now.',
  ].filter(Boolean).join('\n');

  const { content: rawHtml, review: articleReview } = await generateWithReview(
    (hint) => generate(
      buildBodySystem(!!redditContext),
      bodyPrompt + (hint ? `\n\nEditor feedback to address:\n${hint}` : ''),
      { model: 'claude-sonnet-4-6', maxTokens: 4000 }
    ),
    'Ghost', 'ghost'
  );
  logger.info(MODULE, `article review score: ${articleReview.avgScore}`);

  const cleanHtml = insertAffiliateLinks(
    rawHtml.replace(/```html?\n?/g, '').replace(/```/g, '').trim(),
    loadActiveCampaigns(),
  );

  const draft = {
    title: outline.title,
    summary: outline.summary,
    html: cleanHtml + `
<hr>
<div style="background:#f0f4ff;border-left:4px solid #6366F1;padding:20px 24px;margin:32px 0;border-radius:4px">
<p style="margin:0 0 8px;font-weight:bold;font-size:15px">🇯🇵 日本語でも情報発信中</p>
<p style="margin:0 0 12px;font-size:14px;color:#444">AIを使った副業・自動化の実践的な内容を日本語で詳しく解説しています。</p>
<p style="margin:0;font-size:14px">
📝 <a href="https://note.com/rascal_ai" style="color:#6366F1;font-weight:bold">note（詳しい解説記事）</a> &nbsp;|&nbsp;
📷 <a href="https://www.instagram.com/ai_side_hack_/" style="color:#6366F1;font-weight:bold">Instagram（毎日更新）</a> &nbsp;|&nbsp;
🐦 <a href="https://x.com/Rascal_AI_Dev" style="color:#6366F1;font-weight:bold">X / Twitter</a>
</p>
</div>`,
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
