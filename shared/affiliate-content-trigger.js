/**
 * 新規アフィリ案件承認時のコンテンツ自動生成
 * - note下書き生成（runGenerate(theme)）
 * - Instagram account2 アフィリ投稿生成（runAffiliateGenerate）
 * - 両方並列実行
 */
import { logger } from './logger.js';

const MODULE = 'affiliate:trigger';

function buildNoteTheme(campaign) {
  const categoryMap = {
    'Web Hosting':    'サーバー・ホスティング',
    'Automation':     '業務自動化・ノーコード',
    'Online Learning':'オンライン学習・スキルアップ',
    'Productivity':   '生産性向上・タスク管理',
    'AI Tools':       'AIツール活用',
    'Communication':  '通信・Wi-Fi・光回線',
    'Security':       'セキュリティ・VPN',
  };
  const ja = categoryMap[campaign.category] ?? campaign.category;
  return `${campaign.productName}を使って${ja}を効率化する方法【実体験レビュー】`;
}

export async function triggerAffiliateContent(newCampaigns) {
  if (!newCampaigns?.length) return { note: 0, instagram: 0 };

  logger.info(MODULE, `triggering content for ${newCampaigns.length} new campaigns`);

  const results = await Promise.allSettled(
    newCampaigns.map(campaign => generateForCampaign(campaign))
  );

  let noteCount = 0;
  let instaCount = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      noteCount += r.value.note ? 1 : 0;
      instaCount += r.value.instagram ? 1 : 0;
    } else {
      logger.warn(MODULE, `campaign generation failed: ${r.reason?.message}`);
    }
  }

  logger.info(MODULE, `done — note: ${noteCount}, instagram: ${instaCount}`);
  return { note: noteCount, instagram: instaCount };
}

async function generateForCampaign(campaign) {
  const theme = buildNoteTheme(campaign);
  logger.info(MODULE, `campaign: ${campaign.id} | theme: ${theme}`);

  const [noteResult, instaResult] = await Promise.allSettled([
    generateNote(theme, campaign),
    generateInstagram(campaign),
  ]);

  return {
    note:      noteResult.status === 'fulfilled',
    instagram: instaResult.status === 'fulfilled',
  };
}

async function generateNote(theme, campaign) {
  const { runGenerate } = await import('../note/generate.js');
  await runGenerate(theme);
  logger.info(MODULE, `note draft saved for: ${campaign.id}`);
}

async function generateInstagram(campaign) {
  const { runAffiliateGenerate } = await import('../instagram/affiliate.js');
  // 案件を直接渡してaccount2用ドラフト生成
  await runAffiliateGenerate({ forceCampaignId: campaign.id });
  logger.info(MODULE, `instagram draft saved for: ${campaign.id}`);
}
