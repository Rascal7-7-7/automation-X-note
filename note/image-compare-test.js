/**
 * 画像生成バックエンド比較テスト
 *
 * 同一プロンプトで DALL-E 3 と Gemini (Imagen 3) の両方で生成し
 * assets/image-test/ に保存して目視比較できるようにする。
 *
 * 使い方: node note/image-compare-test.js
 */
import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../assets/image-test');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── テスト用プロンプト（noteヘッダー想定）─────────────────────────────
const TEST_CASES = [
  {
    name: 'ai-side-hustle',
    prompt: 'A clean, modern flat design illustration showing a person working on a laptop with AI assistant icons floating around. Japanese minimalist style, blue and white color scheme, professional blog header, 16:9 aspect ratio, no text.',
  },
  {
    name: 'note-monetize',
    prompt: 'A vibrant illustration of coins and a smartphone showing a blog post, surrounded by social media icons. Flat design, warm orange and yellow tones, professional blog header for Japanese audience, no text.',
  },
];

// ── DALL-E 3 ────────────────────────────────────────────────────────
async function generateDallE(prompt, name) {
  if (!process.env.OPENAI_API_KEY) { console.log('[DALL-E] OPENAI_API_KEY not set, skipping'); return; }
  console.log(`[DALL-E 3] generating: ${name}`);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const res = await openai.images.generate({
      model: 'dall-e-3', prompt, n: 1,
      size: '1792x1024', quality: 'standard', response_format: 'url',
    });
    const url = res.data[0].url;
    const dest = path.join(OUT_DIR, `dalle3-${name}.png`);
    await downloadUrl(url, dest);
    console.log(`[DALL-E 3] saved: ${dest}`);
  } catch (err) {
    console.error(`[DALL-E 3] failed: ${err.message}`);
  }
}

// ── Gemini Imagen 4 (predict API) ──────────────────────────────────
async function generateGemini(prompt, name) {
  if (!process.env.GEMINI_API_KEY) { console.log('[Gemini] GEMINI_API_KEY not set, skipping'); return; }
  console.log(`[Gemini Imagen 4] generating: ${name}`);
  const model = 'imagen-4.0-generate-001';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${process.env.GEMINI_API_KEY}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '16:9' },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? JSON.stringify(data));

    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error('no image data in response');

    const dest = path.join(OUT_DIR, `gemini-${name}.png`);
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
    console.log(`[Gemini Imagen 4] saved: ${dest}`);
  } catch (err) {
    console.error(`[Gemini] failed: ${err.message}`);
  }
}

// ── ダウンロードヘルパー ──────────────────────────────────────────────
function downloadUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        return downloadUrl(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

// ── メイン ────────────────────────────────────────────────────────────
console.log('=== 画像生成比較テスト ===');
console.log(`出力先: ${OUT_DIR}\n`);

for (const tc of TEST_CASES) {
  await generateDallE(tc.prompt, tc.name);
  await generateGemini(tc.prompt, tc.name);
  console.log('');
}

console.log('=== 完了 ===');
console.log('assets/image-test/ を開いて比較してください:');
fs.readdirSync(OUT_DIR).forEach(f => console.log(' ', f));
