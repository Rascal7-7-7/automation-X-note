/**
 * Ghost記事 → note アイデアキュー転用
 *
 * Ghost英語記事を日本語noteアイデアに変換してacct1キューに追加する。
 * 重複チェック付き（titleが類似するものはスキップ）。
 *
 * Usage: node ghost/to-note.js [--account 1]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE    = 'ghost:to-note';

const GHOST_DRAFTS = path.join(__dirname, 'drafts');
const NOTE_ROOT    = path.join(__dirname, '../note');

const ACCOUNT_QUEUE = {
  1: path.join(NOTE_ROOT, 'queue', 'ideas.jsonl'),
  2: path.join(NOTE_ROOT, 'queue', 'account2', 'ideas.jsonl'),
  3: path.join(NOTE_ROOT, 'queue', 'account3', 'ideas.jsonl'),
};

const SYSTEM = `あなたはnote記事のアイデアを生成する専門家です。
英語のブログ記事タイトルと概要を受け取り、日本語noteアイデアとして再解釈してください。
必ずJSONで返してください。`;

async function ghostToNoteIdea(draft) {
  const prompt = `以下の英語ブログ記事をnote日本語記事のアイデアに変換してください。

元記事タイトル: ${draft.title}
元記事概要: ${draft.excerpt ?? draft.summary ?? ''}
タグ: ${(draft.tags ?? []).join(', ')}

以下のJSON形式で返してください（コードブロック不要）:
{
  "theme": "記事タイトル案（日本語・40字以内）",
  "angle": "差別化ポイント・切り口（50字以内）",
  "targetWords": ["SEOキーワード1", "キーワード2", "キーワード3"]
}`;

  const raw = await generate(SYSTEM, prompt, { model: 'claude-haiku-4-5-20251001', maxTokens: 300 });
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('no JSON in response');
  return JSON.parse(json);
}

function loadExistingThemes(queuePath) {
  if (!fs.existsSync(queuePath)) return new Set();
  return new Set(
    fs.readFileSync(queuePath, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l).theme ?? ''; } catch { return ''; } })
  );
}

export async function runGhostToNote(accountId = 1) {
  const queuePath = ACCOUNT_QUEUE[accountId];
  if (!queuePath) throw new Error(`unknown account: ${accountId}`);

  const files = fs.readdirSync(GHOST_DRAFTS)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(GHOST_DRAFTS, f));

  if (files.length === 0) {
    logger.info(MODULE, 'no ghost drafts found');
    return { added: 0 };
  }

  const existingThemes = loadExistingThemes(queuePath);
  const added = [];

  for (const file of files) {
    const draft = JSON.parse(fs.readFileSync(file, 'utf8'));

    // postedのみ転用（品質確認済み）
    if (draft.status !== 'posted') continue;

    try {
      const idea = await ghostToNoteIdea(draft);

      // 類似テーマ重複チェック
      const isDup = [...existingThemes].some(t =>
        t && idea.theme && (t.includes(idea.theme.slice(0, 8)) || idea.theme.includes(t.slice(0, 8)))
      );
      if (isDup) {
        logger.info(MODULE, `skip (dup): ${idea.theme}`);
        continue;
      }

      const entry = {
        theme:       idea.theme,
        angle:       idea.angle,
        targetWords: idea.targetWords ?? [],
        sourceUrls:  [draft.ghostUrl ?? ''],
        enqueuedAt:  new Date().toISOString(),
        fromGhost:   true,
      };

      fs.appendFileSync(queuePath, JSON.stringify(entry) + '\n');
      existingThemes.add(idea.theme);
      added.push(idea.theme);
      logger.info(MODULE, `added: ${idea.theme}`);

    } catch (err) {
      logger.warn(MODULE, `failed: ${draft.title?.slice(0, 40)} — ${err.message}`);
    }
  }

  logger.info(MODULE, `done: ${added.length}/${files.length} ideas added to account${accountId}`);
  return { added: added.length, themes: added };
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const accIdx = process.argv.indexOf('--account');
  const accountId = accIdx !== -1 ? Number(process.argv[accIdx + 1]) : 1;
  runGhostToNote(accountId).then(r => {
    console.log(`完了: ${r.added}件追加`);
    r.themes?.forEach(t => console.log(' -', t));
  }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
