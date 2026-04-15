/**
 * note ヘッダー画像生成モジュール
 *
 * フロー:
 *   1. drafts/ から imagePath 未設定の最古ドラフトを取得
 *   2. Claude Haiku でDALL-E向け画像プロンプトを生成
 *   3. DALL-E 3 で 1792×1024（16:9）画像を生成
 *   4. note/drafts/images/ に PNG 保存
 *   5. ドラフト JSON に imagePath を追記
 *
 * 依存: ANTHROPIC_API_KEY, OPENAI_API_KEY
 */
import 'dotenv/config';
import OpenAI from 'openai';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:image';

const DRAFTS_DIR  = path.join(__dirname, 'drafts');
const IMAGES_DIR  = path.join(__dirname, 'drafts/images');

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// OPENAI_API_KEY が未設定でも起動できるよう遅延初期化
let openai = null;
function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set — note image generation unavailable');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ── プロンプト生成 ────────────────────────────────────────────────────
const PROMPT_SYSTEM = `You are an expert at writing DALL-E 3 image generation prompts.
Given a Japanese article title and summary, create an image prompt in English for a professional tech blog header.

Rules:
- Style: clean, minimalist, flat illustration
- Colors: calm, professional (blue/teal/white palette preferred)
- NO text, NO letters, NO characters in the image
- Convey the concept of AI, productivity, or digital work
- Size optimized for 16:9 header image
- Output the prompt only (one sentence, under 200 characters)`;

async function buildImagePrompt(title, summary) {
  const prompt = await generate(
    PROMPT_SYSTEM,
    `Title: ${title}\nSummary: ${summary}`,
    { maxTokens: 200 },
  );
  return prompt.trim();
}

// ── DALL-E 3 生成 ─────────────────────────────────────────────────────
async function generateImage(imagePrompt) {
  logger.info(MODULE, 'calling DALL-E 3', { prompt: imagePrompt });

  const response = await getOpenAI().images.generate({
    model: 'dall-e-3',
    prompt: imagePrompt,
    n: 1,
    size: '1792x1024',    // note.com ヘッダー推奨比率（16:9）
    quality: 'standard',
    response_format: 'url',
  });

  return response.data[0].url;
}

// ── 画像ダウンロード ───────────────────────────────────────────────────
function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

// ── ドラフト操作 ───────────────────────────────────────────────────────
function findOldestDraftWithoutImage() {
  if (!fs.existsSync(DRAFTS_DIR)) return null;

  const files = fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ name: f, filePath: path.join(DRAFTS_DIR, f) }))
    .map(f => ({ ...f, draft: JSON.parse(fs.readFileSync(f.filePath, 'utf8')) }))
    .filter(f => f.draft.status === 'draft' && !f.draft.imagePath)
    .sort((a, b) => a.draft.createdAt.localeCompare(b.draft.createdAt));

  return files[0] ?? null;
}

function attachImageToDraft(filePath, imagePath, imagePrompt) {
  const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const updated = { ...draft, imagePath, imagePrompt };
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, filePath);
}

// ── メイン ────────────────────────────────────────────────────────────
export async function runImage() {
  const file = findOldestDraftWithoutImage();

  if (!file) {
    logger.info(MODULE, 'no drafts awaiting image generation');
    return;
  }

  const { draft } = file;
  logger.info(MODULE, `generating image for: ${draft.title}`);

  try {
    const imagePrompt = await buildImagePrompt(draft.title, draft.summary);
    logger.info(MODULE, 'image prompt built', { imagePrompt });

    const imageUrl = await generateImage(imagePrompt);
    logger.info(MODULE, 'DALL-E 3 returned URL');

    const filename = `${Date.now()}.png`;
    const imagePath = path.join(IMAGES_DIR, filename);
    await downloadImage(imageUrl, imagePath);
    logger.info(MODULE, `image saved: ${imagePath}`);

    attachImageToDraft(file.filePath, imagePath, imagePrompt);
    logger.info(MODULE, `draft updated with imagePath: ${file.filePath}`);
  } catch (err) {
    logger.error(MODULE, 'image generation failed', { message: err.message });
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runImage();
}
