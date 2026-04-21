/**
 * note アカウント2・3用 アイコン・ヘッダー画像生成
 * DALL-E 3 で4枚生成 → assets/note-accounts/ に保存
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

const IMAGES = [
  {
    file: 'account2-icon.png',
    size: '1024x1024',
    prompt: `Professional profile icon for a Japanese investment and AI trading note account.
Design: Dark navy blue background. Centered white/gold minimalist chart line trending upward merging into a subtle circuit board / AI neural network pattern. Small "AI×FX" text badge in bottom right corner. Clean, modern, trustworthy. No text in main area. Flat design, rounded square crop-safe composition.`,
  },
  {
    file: 'account2-header.png',
    size: '1792x1024',
    prompt: `Wide banner header image for a Japanese note.com account about investment, FX trading, and AI automated trading bots.
Design: Dark navy to midnight blue gradient background. Left side: glowing gold candlestick chart / trading dashboard UI elements. Center: bold Japanese-style typography space (leave blank — text will be overlaid). Right side: abstract AI/neural network nodes connected by light lines, with subtle yen/dollar symbols. Professional, modern fintech aesthetic. No actual text in the image.`,
  },
  {
    file: 'account3-icon.png',
    size: '1024x1024',
    prompt: `Professional profile icon for a Japanese affiliate marketing and blogging note account.
Design: Warm white/cream background. Centered icon: a stylized chain link / hyperlink symbol combined with a rising bar chart and small coin stack. Accent color: warm orange and green. Clean flat design. Conveys "passive income from affiliate links". No text. Rounded square crop-safe composition. Friendly and approachable style.`,
  },
  {
    file: 'account3-header.png',
    size: '1792x1024',
    prompt: `Wide banner header image for a Japanese note.com account about affiliate marketing, A8.net, blogging, and passive income.
Design: Clean white/light cream background with warm orange accent gradient on the right edge. Left side: laptop showing a blog/website, with floating icons: chain links, yen coins, upward arrows, shopping cart. Center: open space for text overlay (keep clean). Right side: abstract flow diagram showing "blog post → affiliate link → earnings". Modern, approachable, income-positive aesthetic. No actual text in image.`,
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
for (const img of IMAGES) {
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
