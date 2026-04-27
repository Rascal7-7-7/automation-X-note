/**
 * note記事→Ghost英語変換モジュール
 * - note/drafts/ から最新のposted記事を取得
 * - Claude Sonnet で英語翻訳・リパーパス
 * - ghost/drafts/ にdraftとして保存
 */
import 'dotenv/config';
import fs from 'fs';
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'ghost:translate';
const NOTE_DRAFTS = path.join(__dirname, '../note/drafts');
const GHOST_DRAFTS = path.join(__dirname, 'drafts');

const TRANSLATE_SYSTEM = `You are an expert English content writer who adapts Japanese blog articles for global audiences.

Given a Japanese article, produce an English version that:
- Reads naturally (not like a translation)
- Expands cultural context when needed for Western readers
- Keeps concrete numbers and examples
- Targets readers interested in AI tools, automation, side income
- Returns JSON only:
{
  "title": "English title",
  "summary": "2-sentence meta description under 160 chars",
  "html": "<h2>...</h2><p>...</p>...",
  "tags": ["tag1","tag2","tag3","tag4","tag5"],
  "excerpt": "1-sentence excerpt"
}

HTML rules: use <h2>, <h3>, <p>, <ul>/<li>. No wrapping tags. 1200-2000 words.`;

function findLatestPostedNote() {
  if (!fs.existsSync(NOTE_DRAFTS)) return null;
  return fs.readdirSync(NOTE_DRAFTS)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const filePath = path.join(NOTE_DRAFTS, f);
      return { filePath, draft: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    })
    .filter(f => f.draft.status === 'posted' && !f.draft.ghostTranslated)
    .sort((a, b) => (b.draft.postedAt ?? '').localeCompare(a.draft.postedAt ?? ''))[0] ?? null;
}

function markTranslated(filePath) {
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = { ...draft, ghostTranslated: true, ghostTranslatedAt: new Date().toISOString() };
  saveJSON(filePath, updated);
}

export async function runTranslate(opts = {}) {
  if (!fs.existsSync(GHOST_DRAFTS)) fs.mkdirSync(GHOST_DRAFTS, { recursive: true });

  const file = findLatestPostedNote();
  if (!file) {
    logger.info(MODULE, 'no untranslated posted note articles found');
    return null;
  }

  const { draft } = file;
  logger.info(MODULE, `translating: ${draft.title}`);

  const sourceText = `Title: ${draft.title}\n\nBody:\n${draft.body ?? draft.html ?? ''}`;
  const raw = await generate(TRANSLATE_SYSTEM, sourceText, { model: 'claude-sonnet-4-6', maxTokens: 4000 });

  let translated;
  try {
    translated = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    throw new Error(`translate parse failed: ${raw.slice(0, 200)}`);
  }

  const ghostDraft = {
    ...translated,
    status: 'draft',
    createdAt: new Date().toISOString(),
    sourceType: 'translated',
    sourceNoteTitle: draft.title,
    sourceNoteFile: path.basename(file.filePath),
  };

  const filename = `${Date.now()}-${translated.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)}.json`;
  const filePath = path.join(GHOST_DRAFTS, filename);
  fs.writeFileSync(filePath, JSON.stringify(ghostDraft, null, 2));

  markTranslated(file.filePath);
  logger.info(MODULE, `saved: ${filename}`);

  return ghostDraft;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTranslate().catch(err => { logger.error(MODULE, err.message); process.exit(1); });
}
