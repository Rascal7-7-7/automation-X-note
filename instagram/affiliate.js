/**
 * Instagram アフィリエイト投稿生成（account=2専用）
 *
 * フロー:
 *   asp-campaigns.json からアクティブ案件を選択
 *     ↓ ラウンドロビン（投稿数が少ない順）+ 3日クールダウン
 *   Claude でキャプション + 画像プロンプトを生成
 *     ↓
 *   drafts/account2/{date}/post.json に保存
 *     ↓
 *   campaign の postedCount / lastPostedAt を更新
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../shared/claude-client.js';
import { logger } from '../shared/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMPAIGNS_FILE = path.join(__dirname, 'asp-campaigns.json');
const MODULE         = 'instagram:affiliate';
const COOLDOWN_DAYS  = 3;

// アフィリエイト特化バズ型（ローテーション）
const AFFILIATE_BUZZ_TYPES = [
  { id: 'AF-A', name: '正直レビュー型',     hook: '実際に使ってみた正直な感想' },
  { id: 'AF-B', name: 'ビフォーアフター型', hook: '使う前と後でこう変わった' },
  { id: 'AF-C', name: 'ランキング比較型',   hook: '同ジャンルで比べてみた結果' },
  { id: 'AF-D', name: '悩み解決型',         hook: 'この悩みを持つ人に刺さる情報' },
  { id: 'AF-E', name: 'お得情報型',         hook: '今使うべき理由・キャンペーン情報' },
];

// ── 案件管理 ────────────────────────────────────────────────────────

function loadCampaigns() {
  if (!fs.existsSync(CAMPAIGNS_FILE)) {
    logger.warn(MODULE, `campaigns file not found: ${CAMPAIGNS_FILE}`);
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8')).campaigns ?? [];
  } catch (err) {
    logger.error(MODULE, 'failed to load campaigns', { message: err.message });
    return [];
  }
}

function saveCampaigns(campaigns) {
  const raw      = JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8'));
  const updated  = { ...raw, campaigns };
  const tmp      = CAMPAIGNS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, CAMPAIGNS_FILE);
}

/** ラウンドロビン + クールダウンで次の案件を選択 */
function selectCampaign(campaigns) {
  const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const now        = Date.now();

  const eligible = campaigns.filter(c => {
    if (!c.active) return false;
    if (!c.lastPostedAt) return true;
    return now - new Date(c.lastPostedAt).getTime() > cooldownMs;
  });

  if (eligible.length === 0) return null;

  // 投稿数が少ない順（同数なら ID 昇順）
  return eligible.sort((a, b) =>
    (a.postedCount ?? 0) - (b.postedCount ?? 0) || a.id.localeCompare(b.id)
  )[0];
}

/** 投稿回数に応じてバズ型をローテーション */
function selectBuzzType(campaign) {
  const index = (campaign.postedCount ?? 0) % AFFILIATE_BUZZ_TYPES.length;
  return AFFILIATE_BUZZ_TYPES[index];
}

// ── プロンプト ───────────────────────────────────────────────────────

const CAPTION_SYSTEM = `あなたはアフィリエイトSNS運用の専門家です。
Instagramキャプションを「役立つ情報」として自然に作成してください。

【構造（この順番で書く）】
1行目（フック）: 28文字以内・指定の型に合ったフックを書く。絵文字は末尾1個まで。
（空行）
本文: 商品の特徴・メリット・注意点を3〜5点。各項目は「・」か絵文字で始め1行で改行。
（空行）
保存CTA: 「後で見返せるように保存👆」か「比較するときに保存してね📌」のどちらか。
（空行）
リンク誘導: 「詳細・無料登録はプロフリンクから🔗」を自然に1行で。
（2行空け）
ハッシュタグ: 3〜5個のみ（#副業 #稼ぐ方法 #お金稼ぎ は制限タグのため禁止）

【禁止】
- ハッシュタグ6個以上（シャドーバン原因）
- URL本文挿入
- 「絶対稼げる」「必ず儲かる」等の誇大表現
- キャプション全体400文字以内`;

const IMAGE_PROMPT_SYSTEM = `以下のアフィリエイト商品向けにInstagram投稿用の画像生成プロンプト（英語）を2つ作成してください。
1つ目: 4:5（フィード用）、2つ目: 9:16（Reels/Story用）
条件: クリーンなデザイン・白か薄いグレー背景・商品ジャンルに合う配色・インフォグラフィック風・日本語テキストなし
フォーマット: "Feed: [プロンプト]\nReels: [プロンプト]"のみ出力。`;

// ── メイン ─────────────────────────────────────────────────────────

export async function runAffiliateGenerate({ today, draftDir }) {
  const campaigns = loadCampaigns();
  const campaign  = selectCampaign(campaigns);

  if (!campaign) {
    logger.warn(MODULE, 'no eligible campaigns (all on cooldown or inactive)');
    return null;
  }

  const buzzType = selectBuzzType(campaign);
  logger.info(MODULE, `selected: ${campaign.productName} / ${buzzType.name}`);

  const captionPrompt = `バズる型: ${buzzType.name}（${buzzType.hook}）
商品名: ${campaign.productName}
カテゴリ: ${campaign.category}
報酬タイプ: ${campaign.rewardType}
説明: ${campaign.description}
ターゲット: ${campaign.target}
アピールポイント: ${(campaign.appealPoints ?? []).join('、')}`;

  const imageContext = `商品名: ${campaign.productName}
カテゴリ: ${campaign.category}
説明: ${campaign.description}`;

  const [caption, imagePrompt] = await Promise.all([
    generate(CAPTION_SYSTEM, captionPrompt, { maxTokens: 1024 }),
    generate(IMAGE_PROMPT_SYSTEM, imageContext, { maxTokens: 300 }),
  ]);

  // 投稿実績を更新（イミュータブル）
  const updatedCampaigns = campaigns.map(c =>
    c.id === campaign.id
      ? { ...c, postedCount: (c.postedCount ?? 0) + 1, lastPostedAt: new Date().toISOString() }
      : c
  );
  saveCampaigns(updatedCampaigns);

  const draft = {
    account:     2,
    theme:       campaign.productName,
    buzzType:    buzzType.id,
    buzzTypeName: buzzType.name,
    affiliateCampaign: {
      id:           campaign.id,
      asp:          campaign.asp,
      productName:  campaign.productName,
      category:     campaign.category,
      reward:       campaign.reward,
      affiliateUrl: campaign.affiliateUrl,
    },
    caption,
    imagePrompt,
    date:      today,
    status:    'ready',
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(draftDir, 'post.json'), JSON.stringify(draft, null, 2));
  logger.info(MODULE, `affiliate draft saved → ${draftDir}/post.json`);

  return draft;
}
