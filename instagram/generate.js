/**
 * Instagram 投稿生成
 *
 * フロー:
 *   1. instagram/queue/weekly_plan.json から今日のテーマ・buzzTypeId 取得
 *      （なければ曜日ローテーション）
 *   2. バズる型 × テーマ でキャプション・Reels台本・画像プロンプトを並列生成
 *   3. 画像プロンプトは Nano Banana Pro（Gemini 3 Pro）向け
 *   4. drafts/{date}/post.json に保存
 *
 * weekly_plan.json フォーマット:
 *   { "2026-04-09": { "theme": "副業で稼ぐAI活用法", "buzzTypeId": "F" } }
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS_DIR = path.join(__dirname, 'drafts');
const QUEUE_DIR  = path.join(__dirname, 'queue');
const MODULE     = 'instagram:generate';

// バズる動画の型（@develogon0 の戦略を参考に型テンプレート化）
const BUZZ_TYPES = [
  { id: 'A', name: '有益情報型',       hook: '知らないと損する' },
  { id: 'B', name: '衝撃事実型',       hook: '実はこうだった件' },
  { id: 'C', name: 'ビフォーアフター型', hook: '変わる前と後' },
  { id: 'D', name: '共感・あるある型',  hook: 'こんな経験ない？' },
  { id: 'E', name: 'ストーリー型',      hook: '個人体験から学ぶ' },
  { id: 'F', name: 'ランキング型',      hook: '厳選おすすめ' },
  { id: 'G', name: 'How-to型',         hook: 'ステップで解説' },
  { id: 'H', name: 'アフィリエイト型',  hook: '実際に使って月〇〇円稼いだツールを正直レビュー', cta: '詳細はプロフィールリンクから無料で試せます' },
];

// アフィリエイト対象AIツールリスト
const AFFILIATE_PRODUCTS = [
  { name: 'Claude Pro',      url: 'claude.ai',        price: '月$20',  feature: 'コード生成・分析' },
  { name: 'ChatGPT Plus',    url: 'openai.com',       price: '月$20',  feature: '汎用AI' },
  { name: 'Midjourney',      url: 'midjourney.com',   price: '月$10〜', feature: '画像生成' },
  { name: 'Perplexity Pro',  url: 'perplexity.ai',    price: '月$20',  feature: 'AI検索' },
  { name: 'Notion AI',       url: 'notion.so',        price: '月$10〜', feature: '知識管理' },
];

// アカウント別プロフィール定義
const ACCOUNT_PROFILES = {
  1: {
    name:    'AI副業系',
    persona: 'AIツールと副業情報を発信するInstagramアカウントの運営者',
    topics:  ['AIツール活用術', 'Claude Code 使い方', '副業で稼ぐAI活用法', 'ChatGPT時短テクニック', 'おすすめAIツール比較', '生産性を上げるAI習慣', 'AI初心者向けガイド'],
    cta:     'プロフのリンクから👆',
    hashtags: '#AI副業 #Claude #ChatGPT #副業 #自動化 #AI活用 #在宅ワーク',
  },
  2: {
    name:    'アフィリ集客系',
    persona: 'アフィリエイト・集客戦略を発信するInstagramアカウントの運営者',
    topics:  ['高単価アフィリ案件の見つけ方', '集客できる投稿術', 'フォロワー0からの始め方', 'アフィリ月10万への道', 'SNS集客の基本', 'プロフィール最適化術', 'アフィリ初心者ガイド'],
    cta:     'おすすめ案件一覧はプロフから🔗',
    hashtags: '#アフィリエイト #集客 #副業 #SNSマーケティング #インスタ集客 #アフィリ初心者',
  },
};

function buildCaptionSystem(account) {
  const p = ACCOUNT_PROFILES[account];
  return `あなたは${p.persona}です。
指定された「バズる型」に従ってキャプションを作成してください：
- 1行目: 型に合わせたフック（絵文字1〜2個）
- 本文: 有益な情報を3〜5点（各項目を改行・絵文字で区切る）
- 末尾にハッシュタグ15〜20個（関連度順、必ず含める: ${p.hashtags}）
- CTA（「${p.cta}」など）を必ず含める
- 全体500文字以内`;
}

const REELS_SYSTEM = `以下のテーマ・型に対して、Instagram Reels用の短い台本（15〜30秒）を作成してください。
構成: 冒頭3秒フック → 本編（箇条書き） → CTA
Renoise等の動画生成AIに渡すことを想定し、自然な話し言葉で書いてください。`;

const IMAGE_PROMPT_SYSTEM = `以下のテーマに対して、Nano Banana Pro（Gemini 3 Pro）用の画像生成プロンプト（英語）を2つ作成してください。
1つ目: 4:5（フィード用）、2つ目: 9:16（Reels/Story用）
条件: クリーンなデザイン、インフォグラフィック風、白または薄いグレー背景、日本語テキストなし（後でオーバーレイ）
型に合わせたビジュアル（ランキング→比較表、How-to→手順図など）
フォーマット: "Feed: [プロンプト]\nReels: [プロンプト]"のみ出力。`;

function buildAffiliateCaptionSystem(account) {
  const p = ACCOUNT_PROFILES[account];
  return `あなたは${p.persona}です。
指定されたAIツールについて、正直なレビュー形式のInstagramキャプションを作成してください：
- 1行目: 「実際に使って月〇〇円稼いだツールを正直レビュー🔍」（金額は実際っぽい数字に変える）
- メリット2〜3点（具体的に）
- デメリット1〜2点（正直に書く）
- 具体的な使用シーン・ユースケース
- 価格情報
- CTA: 「プロフィールリンクから試せます」を自然に含める
- ハッシュタグ3〜5個（関連度が高いもののみ）
- 全体400文字以内`;
}

async function generateAffiliateCaption(account, product) {
  const system = buildAffiliateCaptionSystem(account);
  const prompt = `ツール名: ${product.name}
URL: ${product.url}
価格: ${product.price}
主な特徴: ${product.feature}

上記ツールの正直レビューキャプションを作成してください。`;

  return generate(system, prompt, {
    model: 'claude-sonnet-4-6',
    maxTokens: 1024,
  });
}

export async function runGenerate({ account = 1, type } = {}) {
  const profile  = ACCOUNT_PROFILES[account] ?? ACCOUNT_PROFILES[1];
  const today    = new Date().toISOString().split('T')[0];
  const draftDir = path.join(DRAFTS_DIR, `account${account}`, today);

  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });
  if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

  const { theme, buzzType } = getTodayContent(account, profile, type);
  logger.info(MODULE, `account${account}: theme="${theme}" type=${buzzType.name}`);

  // アフィリエイト型は専用フローで処理
  if (type === 'affiliate' || buzzType.id === 'H') {
    return runAffiliateGenerate({ account, profile, today, draftDir, buzzType });
  }

  const context = `バズる型: ${buzzType.name}（${buzzType.hook}）\nテーマ: ${theme}`;

  const [caption, reelsScript, imagePrompt] = await Promise.all([
    generate(buildCaptionSystem(account), `${context}\nキャプションを作成してください。`, {
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
    }),
    generate(REELS_SYSTEM, context, { maxTokens: 512 }),
    generate(IMAGE_PROMPT_SYSTEM, context, { maxTokens: 300 }),
  ]);

  const draft = {
    account,
    theme,
    buzzType:     buzzType.id,
    buzzTypeName: buzzType.name,
    caption,
    reelsScript,
    imagePrompt,
    date:         today,
    status:       'ready',
    createdAt:    new Date().toISOString(),
  };

  const draftPath = path.join(draftDir, 'post.json');
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  logger.info(MODULE, `account${account} draft saved → ${draftPath}`);

  return draft;
}

async function runAffiliateGenerate({ account, profile, today, draftDir, buzzType }) {
  const product = AFFILIATE_PRODUCTS[Math.floor(Math.random() * AFFILIATE_PRODUCTS.length)];
  const theme   = `${product.name} 正直レビュー`;
  logger.info(MODULE, `account${account}: affiliate review for ${product.name}`);

  const context = `バズる型: ${buzzType.name}（${buzzType.hook}）\nテーマ: ${theme}`;

  const [caption, reelsScript, imagePrompt] = await Promise.all([
    generateAffiliateCaption(account, product),
    generate(REELS_SYSTEM, context, { maxTokens: 512 }),
    generate(IMAGE_PROMPT_SYSTEM, context, { maxTokens: 300 }),
  ]);

  const draft = {
    account,
    theme,
    buzzType:          buzzType.id,
    buzzTypeName:      buzzType.name,
    affiliateProduct:  product,
    caption,
    reelsScript,
    imagePrompt,
    date:              today,
    status:            'ready',
    createdAt:         new Date().toISOString(),
  };

  const draftPath = path.join(draftDir, 'post.json');
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  logger.info(MODULE, `account${account} affiliate draft saved → ${draftPath}`);

  return draft;
}

function getTodayContent(account, profile, type) {
  const planFile = path.join(QUEUE_DIR, `weekly_plan_${account}.json`);
  const dayIndex = new Date().getDay();

  // Explicit affiliate type override
  if (type === 'affiliate') {
    return {
      theme:    'AIツール アフィリエイトレビュー',
      buzzType: BUZZ_TYPES.find(t => t.id === 'H'),
    };
  }

  if (fs.existsSync(planFile)) {
    try {
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const key  = new Date().toISOString().split('T')[0];
      if (plan[key]) {
        const { theme, buzzTypeId } = plan[key];
        const buzzType = BUZZ_TYPES.find(t => t.id === buzzTypeId) ?? BUZZ_TYPES[dayIndex % BUZZ_TYPES.length];
        return { theme, buzzType };
      }
    } catch { /* fallback below */ }
  }

  return {
    theme:    profile.topics[dayIndex % profile.topics.length],
    buzzType: BUZZ_TYPES[dayIndex % BUZZ_TYPES.length],
  };
}
