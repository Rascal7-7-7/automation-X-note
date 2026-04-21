/**
 * キャラクターベース アイコン生成
 * 既存のアニメキャラ（銀髪・フード）スタイルを踏襲した
 * アカウント別テーマアイコンをDALL-E 3で生成
 *
 * 使い方: node assets/generate-character-icons.js
 */
import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'note-accounts');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// キャラクター基本定義（参照画像から）
const CHAR_BASE = `anime illustration style, high quality digital art, soft shading.
Character: young male, short silver-white hair slightly swept to the side, warm brown eyes, friendly warm smile, clean handsome face with soft features.`;

const ICONS = [
  {
    file: 'account2-icon-char.png',
    size: '1024x1024',
    prompt: `${CHAR_BASE}
Outfit: sharp navy blue business suit with white shirt and subtle gold tie. Professional yet approachable.
Background: dark navy to deep blue gradient with faint glowing candlestick chart lines and subtle circuit/AI neural network pattern. Stock market fintech aesthetic.
Composition: centered bust portrait, square crop safe, face fills upper 60% of frame.
Mood: confident, trustworthy, professional investor persona.
No text, no watermark.`,
  },
  {
    file: 'account3-icon-char.png',
    size: '1024x1024',
    prompt: `${CHAR_BASE}
Outfit: casual gray hoodie (same as reference), relaxed pose, holding a slim laptop slightly to the side.
Background: warm cream/off-white with soft orange gradient corner accents. Floating minimal icons: chain link symbol, yen coin, upward arrow graph. Passive income / blog affiliate aesthetic.
Composition: centered bust portrait, square crop safe, face fills upper 55% of frame.
Mood: friendly, approachable, relatable side-hustler.
No text, no watermark.`,
  },
];

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function generateImage({ file, size, prompt }) {
  console.log(`Generating ${file}...`);
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    size,
    quality: 'hd',
    n: 1,
  });
  const url = response.data[0].url;
  const dest = path.join(OUT_DIR, file);
  await downloadImage(url, dest);
  console.log(`✓ Saved: ${dest}`);
  return dest;
}

const results = [];
for (const img of ICONS) {
  try {
    const dest = await generateImage(img);
    results.push({ file: img.file, path: dest, ok: true });
  } catch (err) {
    console.error(`✗ ${img.file}: ${err.message}`);
    results.push({ file: img.file, ok: false, error: err.message });
  }
}

console.log('\n=== 完了 ===');
results.forEach(r => console.log(r.ok ? `✓ ${r.file}` : `✗ ${r.file}: ${r.error}`));
console.log('\n生成ファイル:');
console.log('  assets/note-accounts/account2-icon-char.png  (投資FX版)');
console.log('  assets/note-accounts/account3-icon-char.png  (アフィリ版)');
