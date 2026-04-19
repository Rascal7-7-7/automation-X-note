/**
 * Ghost英語記事生成モジュール
 * - ghost/queue/ideas.jsonl からテーマを取得
 * - Claude Sonnet で outline → body の2段階生成（英語）
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

const OUTLINE_SYSTEM = `You are an expert English-language content writer targeting global audiences interested in AI, automation, and side income.

Given a topic, return a JSON outline ONLY (no other text):
{
  "title": "Engaging title with numbers or power words",
  "summary": "2-sentence summary under 160 chars (SEO meta description)",
  "sections": ["Section 1", "Section 2", "Section 3", "Section 4", "Section 5"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}

Title rules:
- Include a number (e.g. "5 Ways", "3 Tools", "in 30 Days")
- Use power words: Ultimate, Proven, Beginner's, Step-by-Step
- Focus: AI side hustle, automation income, Claude Code, Japan tech

Tags: 5 lowercase English keywords relevant to topic (no #).`;

const BODY_SYSTEM = `You are an expert English content writer for a Ghost blog targeting global readers.
Write a 1500-2000 word article in HTML format based on the outline provided.

Rules:
- Start directly with content (no <html>, <body> tags)
- Use <h2> for section headings, <h3> for sub-headings
- Use <p> for paragraphs, <ul>/<li> for lists
- Include concrete examples, numbers, and actionable steps
- First-person voice where appropriate ("I automated...", "In my experience...")
- Natural English — no machine-translation feel
- End with a clear call-to-action paragraph
- Do NOT wrap in markdown code blocks`;

export async function runGenerate(opts = {}) {
  if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

  const idea = await ideaQueue.shift();
  if (!idea) {
    logger.info(MODULE, 'no ideas in queue — using default topic');
  }

  const topic = idea?.topic ?? 'How I automated my social media income with Claude AI';
  logger.info(MODULE, `generating: ${topic}`);

  // Stage 1: Outline
  const outlineRaw = await generate(OUTLINE_SYSTEM, `Topic: ${topic}`, { model: 'claude-sonnet-4-6' });
  let outline;
  try {
    outline = JSON.parse(outlineRaw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    throw new Error(`outline parse failed: ${outlineRaw.slice(0, 200)}`);
  }
  logger.info(MODULE, `outline: ${outline.title}`);

  // Stage 2: Body
  const outlineText = outline.sections.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const bodyPrompt = `Title: ${outline.title}\nSummary: ${outline.summary}\n\nSections:\n${outlineText}\n\nWrite the full article now.`;
  const html = await generate(BODY_SYSTEM, bodyPrompt, { model: 'claude-sonnet-4-6', maxTokens: 4000 });

  const draft = {
    title: outline.title,
    summary: outline.summary,
    html: html.replace(/```html?\n?/g, '').replace(/```/g, '').trim(),
    tags: outline.tags,
    excerpt: outline.summary,
    status: 'draft',
    createdAt: new Date().toISOString(),
    sourceTopic: topic,
    sourceType: 'original',
  };

  const filename = `${Date.now()}-${outline.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.json`;
  const filePath = path.join(DRAFTS_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(draft, null, 2));
  logger.info(MODULE, `saved: ${filename}`);

  return draft;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runGenerate().catch(err => { logger.error(MODULE, err.message); process.exit(1); });
}
