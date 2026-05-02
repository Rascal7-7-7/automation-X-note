/**
 * note ヘッダー画像生成モジュール
 *
 * フロー:
 *   1. drafts/ から imagePath 未設定の最古ドラフトを取得
 *   2. Claude Haiku で Imagen 4 最適化プロンプトを生成
 *   3. Gemini Imagen 4 で 16:9 画像を生成
 *   4. note/drafts/images/ に PNG 保存
 *   5. ドラフト JSON に imagePath を追記
 *
 * 依存: ANTHROPIC_API_KEY, GEMINI_API_KEY
 */
import 'dotenv/config';
import fs from 'fs';
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'note:image';

const DRAFTS_DIR = path.join(__dirname, 'drafts');
const IMAGES_DIR = path.join(__dirname, 'drafts/images');

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// ── Imagen 4 最適化プロンプト生成 ────────────────────────────────────
const PROMPT_SYSTEM = `You are an expert Imagen 4 prompt engineer specializing in Japanese blog header images (16:9 aspect ratio).

Given a blog article title and topic, generate ONE Imagen 4 image prompt following this exact structure:
[Subject/scene] + [background/environment] + [Japanese aesthetic style] + [lighting descriptor] + [composition term] + [quality modifiers]

Rules:
- Keep prompt under 180 characters
- Start with "A photo of" or "A cinematic scene of" for photorealism
- Always include ONE lighting term: golden hour / soft diffused light / cool blue morning light / warm studio light
- Always include ONE composition term: rule of thirds / centered symmetry / wide establishing shot
- Always include style anchors: wabi-sabi minimalism OR Japanese editorial OR clean modern flat
- Add: highly detailed, sharp focus, 16:9 composition
- NO people unless explicitly requested — objects and environments only
- NO text in the image

Output format: Just the prompt, no explanation.`;

async function buildImagePrompt(title, summary) {
  const prompt = await generate(
    PROMPT_SYSTEM,
    `Title: ${title}\nSummary: ${summary}`,
    { maxTokens: 200, model: 'claude-haiku-4-5-20251001' },
  );
  return prompt.trim();
}

// ── Gemini Imagen 4 生成 ──────────────────────────────────────────────
async function generateImage(imagePrompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set — note image generation unavailable');

  logger.info(MODULE, 'calling Gemini Imagen 4', { prompt: imagePrompt });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: imagePrompt }],
        parameters: { sampleCount: 1, aspectRatio: '16:9' },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`Imagen 4 error: ${data.error?.message ?? JSON.stringify(data)}`);

  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen 4: no image data in response');

  return b64; // base64
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
  saveJSON(filePath, updated);
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

    const b64 = await generateImage(imagePrompt);
    logger.info(MODULE, 'Imagen 4 returned image');

    const filename = `${Date.now()}.png`;
    const imagePath = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(imagePath, Buffer.from(b64, 'base64'));
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
