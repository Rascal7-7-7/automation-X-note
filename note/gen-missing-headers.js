/**
 * Generate header images for articles missing them.
 * Usage: node note/gen-missing-headers.js
 */
import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = path.join(__dirname, '..', '.tmp-note-images');

fs.mkdirSync(IMAGE_DIR, { recursive: true });

const TARGETS = [
  {
    draftFile: path.join(__dirname, 'drafts', '1775067089124-AI執筆ツールを使い始めて2週間で記事数.json'),
    noteKey: 'nd15b3ad263b3',
    outputName: 'header-nd15b3ad263b3.png',
    prompt: 'Dark navy to deep purple gradient background, glowing minimalist writing quill transforming into a digital cursor, floating article cards multiplying in a cascade, upward trend graph lines, clean professional Japanese tech blog header, 16:9, no text',
  },
  {
    draftFile: path.join(__dirname, 'drafts', '1776437061967-スキルゼロからClaude_AIで副業月.json'),
    noteKey: 'n049a7c9224a7',
    outputName: 'header-n049a7c9224a7.png',
    prompt: 'Dark charcoal to deep indigo gradient background, glowing AI neural network brain icon with five ascending illuminated steps, Japanese yen coin stacking into mountain, subtle circuit board patterns, minimalist professional tech blog header, 16:9, no text',
  },
  {
    draftFile: path.join(__dirname, 'drafts', '1776618755960-onamae-server.json'),
    noteKey: 'n2896926bf7b9',
    outputName: 'header-n2896926bf7b9.png',
    prompt: 'Dark navy gradient background, sleek blog website wireframe floating in space with rocket launch trail, Claude AI abstract glowing orb merging with domain name server icon, minimalist professional tech blog header, 16:9, no text',
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

  for (const target of TARGETS) {
    const outPath = path.join(IMAGE_DIR, target.outputName);
    if (fs.existsSync(outPath)) {
      console.log(`already exists: ${target.outputName}`);
      continue;
    }

    console.log(`\nGenerating: ${target.outputName}`);
    console.log(`Prompt: ${target.prompt.slice(0, 80)}...`);

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: target.prompt,
      n: 1,
      size: '1792x1024',
      quality: 'standard',
      response_format: 'url',
    });

    const imageUrl = response.data[0].url;
    await downloadImage(imageUrl, outPath);
    console.log(`  saved: ${outPath}`);

    // Update draft JSON with headerImage
    if (fs.existsSync(target.draftFile)) {
      const draft = JSON.parse(fs.readFileSync(target.draftFile, 'utf8'));
      if (!draft.headerImage) {
        const updated = { ...draft, headerImage: outPath };
        fs.writeFileSync(target.draftFile, JSON.stringify(updated, null, 2));
        console.log(`  draft updated: ${path.basename(target.draftFile)}`);
      }
    }

    // Avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\nDone. Now run publish-draft.js to upload to note.com');
}

main().catch(err => { console.error(err.message); process.exit(1); });
