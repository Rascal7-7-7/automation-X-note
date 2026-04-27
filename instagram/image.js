/**
 * Instagram 画像生成モジュール
 *
 * フロー:
 *   1. drafts/account{N}/{today}/post.json の imagePrompt を読み込む
 *   2. DALL-E 3 で画像生成
 *   3. GitHub リポジトリ（rascal7-7-7/automation-X-note）に push
 *      → raw.githubusercontent.com の永続 HTTPS URL を取得
 *   4. draft.imageUrl に書き戻す（post.js が参照）
 *
 * 依存:
 *   OPENAI_API_KEY — DALL-E 3 用
 *   gh CLI         — GitHub 認証済みであること（gh auth login 済み）
 *
 * 画像保存先リポジトリ:
 *   https://github.com/rascal7-7-7/automation-X-note
 *   パス: instagram-images/{date}-account{N}-{timestamp}.png
 */
import 'dotenv/config';
import OpenAI from 'openai';
import { execFileSync } from 'child_process';
import https from 'https';
import fs from 'fs';
import { saveJSON } from '../shared/file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const TMP_DIR    = path.join(__dirname, 'tmp');
const MODULE     = 'instagram:image';

const GITHUB_OWNER  = 'rascal7-7-7';
const GITHUB_REPO   = 'automation-X-note';
const GITHUB_BRANCH = 'main';
const IMAGES_PATH   = 'instagram-images';

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── OpenAI 遅延初期化 ──────────────────────────────────────────────────
let openai = null;
function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set — Instagram image generation unavailable');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ── DALL-E 3 生成 ──────────────────────────────────────────────────────
async function generateWithDallE(prompt) {
  logger.info(MODULE, 'calling DALL-E 3', { prompt });
  const res = await getOpenAI().images.generate({
    model:           'dall-e-3',
    prompt,
    n:               1,
    size:            '1024x1024',
    quality:         'standard',
    response_format: 'url',
  });
  return res.data[0].url;
}

// ── 画像ダウンロード（Buffer） ─────────────────────────────────────────
function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`download failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end',  ()  => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── GitHub へアップロード ──────────────────────────────────────────────
async function uploadToGitHub(imageBuffer, filename) {
  // gh CLI から現在の認証トークンを取得
  const token = execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  }).trim();

  const filePath    = `${IMAGES_PATH}/${filename}`;
  const apiUrl      = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const base64      = imageBuffer.toString('base64');

  const body = {
    message: `chore: add instagram image ${filename}`,
    content: base64,
    branch:  GITHUB_BRANCH,
  };

  const res  = await fetch(apiUrl, {
    method:  'PUT',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (res.status !== 201) {
    throw new Error(`GitHub upload failed (${res.status}): ${JSON.stringify(data)}`);
  }

  // raw.githubusercontent.com の永続 URL を返す
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;
}

// ── メイン ────────────────────────────────────────────────────────────
export async function runImage({ account = 1 } = {}) {
  const today     = new Date().toISOString().split('T')[0];
  const draftDir  = path.join(DRAFTS_DIR, `account${account}`, today);
  const draftPath = path.join(draftDir, 'post.json');

  if (!fs.existsSync(draftPath)) {
    logger.warn(MODULE, `no draft found for account${account} today: ${draftPath}`);
    return;
  }

  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

  if (draft.imageUrl) {
    logger.info(MODULE, `imageUrl already set — skipping: ${draft.imageUrl}`);
    return;
  }

  if (!draft.imagePrompt) {
    logger.warn(MODULE, `no imagePrompt in draft for account${account} — skipping`);
    return;
  }

  // "Feed: <英語プロンプト>\nReels: <英語プロンプト>" からフィード用プロンプトを抽出
  const feedMatch = draft.imagePrompt.match(/Feed:\s*(.+?)(?:\n|$)/i);
  const prompt    = feedMatch ? feedMatch[1].trim() : draft.imagePrompt;

  logger.info(MODULE, `generating image for account${account}`);

  try {
    const dalleUrl    = await generateWithDallE(prompt);
    logger.info(MODULE, 'DALL-E 3 returned URL');

    const imageBuffer = await downloadToBuffer(dalleUrl);
    logger.info(MODULE, `image downloaded: ${imageBuffer.length} bytes`);

    const filename    = `${today}-account${account}-${Date.now()}.png`;
    const imageUrl    = await uploadToGitHub(imageBuffer, filename);
    logger.info(MODULE, `GitHub upload done: ${imageUrl}`);

    const updated = { ...draft, imageUrl };
    saveJSON(draftPath, updated);
    logger.info(MODULE, `draft updated with imageUrl → ${draftPath}`);
  } catch (err) {
    logger.error(MODULE, 'image generation/upload failed', { message: err.message });
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runImage({ account: parseInt(process.argv[2] ?? '1', 10) });
}
