/**
 * Generate in-article images for all note.com articles.
 * Usage: node note/gen-article-images.js
 */
import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = path.join(__dirname, '..', '.tmp-note-images', 'article');
fs.mkdirSync(IMAGE_DIR, { recursive: true });

// Each entry: { file, noteKey, account, images: [{ name, heading, prompt }] }
const ARTICLE_IMAGES = [
  {
    noteKey: 'nd15b3ad263b3', account: 1,
    images: [
      {
        name: 'nd15b3-img1.png',
        heading: '解決策：AIに「考える作業」を丸ごと任せる',
        prompt: 'Dark navy background, minimalist flat illustration of a human brain handing tasks to a glowing AI robot assistant, arrows showing delegation flow, clean professional tech blog style, 16:9, no text',
      },
      {
        name: 'nd15b3-img2.png',
        heading: '具体例：ChatGPT × Notion AIで1記事90分→18分',
        prompt: 'Dark navy to purple gradient, two side-by-side clocks showing 90 minutes crossed out versus 18 minutes highlighted in green, minimalist flat design, clean professional tech blog style, 16:9, no text',
      },
    ],
  },
  {
    noteKey: 'n049a7c9224a7', account: 1,
    images: [
      {
        name: 'n049a7-img1.png',
        heading: '3. Claude AIで月3万達成した5つのステップ',
        prompt: 'Dark indigo background, five illuminated ascending steps as a staircase, each step glowing with tech blue light, Japanese yen coin at the top, clean minimalist flat design, professional tech blog, 16:9, no text',
      },
    ],
  },
  {
    noteKey: 'n2896926bf7b9', account: 1,
    images: [
      {
        name: 'n2896-img1.png',
        heading: 'なぜサーバー選びが重要なのか',
        prompt: 'Dark navy background, minimalist server rack illustration with speed/performance comparison bars, green checkmark on fast server vs red X on slow server, clean flat design, professional tech blog, 16:9, no text',
      },
    ],
  },
  {
    noteKey: 'n13dda47d1ecf', account: 1,
    images: [
      {
        name: 'n13dda-img1.png',
        heading: '3. ChatGPT×noteの7ステップ時短フロー',
        prompt: 'Dark navy to teal gradient, seven connected horizontal nodes in a workflow diagram, each node glowing with blue light, arrows connecting them left to right, minimalist flat design, professional tech blog, 16:9, no text',
      },
    ],
  },
  {
    noteKey: 'n76316ffc87a3', account: 1,
    images: [
      {
        name: 'n76316-img1.png',
        heading: '3. X×note連携7ステップ収益化設計図',
        prompt: 'Dark navy background, X (Twitter) bird icon and note.com document icon connected by glowing arrows in a circular revenue flow, money/coin icons at connection points, minimalist flat design, 16:9, no text',
      },
    ],
  },
  {
    noteKey: 'n1ef15b5d8772', account: 1,
    images: [
      {
        name: 'n1ef15-img1.png',
        heading: '3. Claude×n8n自動化の収益モデル解説',
        prompt: 'Dark indigo background, n8n workflow nodes connected to Claude AI orb, with upward revenue graph on the right, minimalist flat illustration, professional tech blog style, 16:9, no text',
      },
    ],
  },
  {
    noteKey: 'nd563d3f39dc1', account: 2,
    images: [
      {
        name: 'nd563d-img1.png',
        heading: '3. n8n＋ClaudeでAI自動判定フローを構築する',
        prompt: 'Dark navy background, n8n workflow canvas illustration with three connected nodes labeled with gear icons, Claude AI brain icon as central processor, tax document being processed, clean flat design, 16:9, no text',
      },
    ],
  },
  {
    noteKey: 'n6057ecd62564', account: 3,
    images: [
      {
        name: 'n6057e-img1.png',
        heading: '3. 収益に直結するAIツールの正しい選び方5ステップ',
        prompt: 'Dark navy to dark purple gradient, five AI tool icons in a funnel/selection flowchart, green checkmarks and red X marks filtering choices, minimalist flat design, professional tech blog, 16:9, no text',
      },
    ],
  },
];

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const manifest = [];

  for (const article of ARTICLE_IMAGES) {
    for (const img of article.images) {
      const outPath = path.join(IMAGE_DIR, img.name);
      if (fs.existsSync(outPath)) {
        console.log(`already exists: ${img.name}`);
        manifest.push({ ...img, noteKey: article.noteKey, account: article.account, path: outPath });
        continue;
      }

      console.log(`\nGenerating: ${img.name}`);
      console.log(`Article: ${article.noteKey}, after: "${img.heading.slice(0, 50)}"`);

      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: img.prompt,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
        response_format: 'url',
      });

      await downloadImage(response.data[0].url, outPath);
      console.log(`  saved: ${outPath}`);
      manifest.push({ ...img, noteKey: article.noteKey, account: article.account, path: outPath });

      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Save manifest for the insertion script to use
  const manifestPath = path.join(IMAGE_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest saved: ${manifestPath}`);
  console.log(`Total images: ${manifest.length}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
