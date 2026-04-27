/**
 * A8.net 承認済み案件の自動URL同期
 * - A8.netにログインして承認済み案件一覧を取得
 * - ghost/asp-campaigns.json と instagram/asp-campaigns.json を更新
 * - 案件名マッチ（部分一致・大文字小文字無視）でURLを自動セット
 * - active: true は URL がセットされた時点で自動設定
 */
import 'dotenv/config';
import fs from 'fs';
import { saveJSON } from './file-utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE = 'a8:sync';

const CAMPAIGN_FILES = [
  path.join(__dirname, '../ghost/asp-campaigns.json'),
  path.join(__dirname, '../instagram/asp-campaigns.json'),
];

const A8_LOGIN_URL = 'https://pub.a8.net/a8v2/asLoginAction.do';
const A8_PROGRAMS_URL = 'https://pub.a8.net/a8v2/media/partnerProgramListAction.do?act=search&viewPage=';

function loadCampaignFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveCampaignFile(filePath, data) {
  saveJSON(filePath, data);
}

function normalizeProductName(name) {
  return name.toLowerCase().replace(/[^a-z0-9\u3040-\u9fff]/g, '');
}

function matchCampaign(campaigns, a8Name) {
  const norm = normalizeProductName(a8Name);
  return campaigns.find(c => {
    const cNorm = normalizeProductName(c.productName);
    return norm.includes(cNorm) || cNorm.includes(norm);
  });
}

async function getTextSafe(locator) {
  try { return (await locator.first().textContent({ timeout: 2000 }))?.trim() ?? ''; }
  catch { return ''; }
}

async function getAttrSafe(locator, attr) {
  try { return (await locator.first().getAttribute(attr, { timeout: 2000 })) ?? ''; }
  catch { return ''; }
}

async function fetchApprovedPrograms(page) {
  await page.goto(A8_PROGRAMS_URL, { waitUntil: 'networkidle' });
  const programs = [];

  // Rows with linkAction.do links are the program rows (skip header rows)
  const rows = await page.locator('table tr').all();
  for (const row of rows) {
    const linkEl = row.locator('a[href*="linkAction.do"]').first();
    if (await linkEl.count() === 0) continue;

    const detailUrl = await getAttrSafe(linkEl, 'href');
    const rowText = (await row.textContent().catch(() => '')) ?? '';
    // Extract program name from "プログラム名 [name](YY-MMDD)" pattern
    const nameMatch = rowText.match(/プログラム名\s+(.+?)\s*\(\d{2}-\d{4}\)/);
    const name = nameMatch ? nameMatch[1].trim() : rowText.slice(0, 60).trim();
    if (name) programs.push({ name, detailUrl });
  }

  return programs;
}

async function extractAffiliateUrl(page, detailUrl) {
  if (!detailUrl) return null;
  try {
    const fullUrl = detailUrl.startsWith('http') ? detailUrl : `https://pub.a8.net${detailUrl}`;
    await page.goto(fullUrl, { waitUntil: 'networkidle' });

    // px.a8.net URLs are in textareas as plain text or HTML snippet
    const textareas = page.locator('textarea');
    const count = await textareas.count();
    for (let i = 0; i < count; i++) {
      const val = await textareas.nth(i).inputValue().catch(() => '');
      const match = val.match(/https:\/\/px\.a8\.net\/[^\s"<]+/);
      if (match) return match[0];
    }

    return null;
  } catch {
    return null;
  }
}

export async function syncA8Affiliates(opts = {}) {
  const email = process.env.A8_LOGIN_ID ?? process.env.A8_EMAIL;
  const password = process.env.A8_PASSWORD;
  if (!email || !password) throw new Error('A8_LOGIN_ID (ログインID) and A8_PASSWORD required in .env');

  logger.info(MODULE, 'launching browser');
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'ja-JP',
  });
  const page = await context.newPage();

  try {
    logger.info(MODULE, 'logging in to A8.net');
    await page.goto(A8_LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="login"]').first().fill(email);
    await page.locator('input[name="passwd"]').first().fill(password);
    await page.locator('input[type="submit"]').first().click();
    await page.waitForLoadState('networkidle');

    if (await page.locator('text=IDやパスワードが違います').count() > 0) {
      throw new Error('A8.net login failed — check A8_LOGIN_ID (ログインID, not email) / A8_PASSWORD in .env');
    }
    logger.info(MODULE, 'login success');

    const programs = await fetchApprovedPrograms(page);
    logger.info(MODULE, `found ${programs.length} approved programs`);
    if (!programs.length) {
      logger.info(MODULE, 'no approved programs — check login or program list URL');
      return { updated: 0 };
    }

    let totalUpdated = 0;
    const newCampaigns = [];

    for (const filePath of CAMPAIGN_FILES) {
      if (!fs.existsSync(filePath)) continue;
      const data = loadCampaignFile(filePath);
      let fileUpdated = 0;

      for (const program of programs) {
        const campaign = matchCampaign(data.campaigns, program.name);
        if (!campaign || campaign.affiliateUrl) continue;

        logger.info(MODULE, `matched: "${program.name}" → ${campaign.id}`);
        const url = await extractAffiliateUrl(page, program.detailUrl);

        if (url) {
          campaign.affiliateUrl = url;
          campaign.active = true;
          logger.info(MODULE, `activated ${campaign.id}`);
          fileUpdated++;
          // 重複なしで記録（ghost/instagram 両ファイルで同じ案件が出る場合）
          if (!newCampaigns.find(c => c.id === campaign.id)) {
            newCampaigns.push({ ...campaign });
          }
        } else {
          logger.warn(MODULE, `URL not found for ${campaign.id} — set manually`);
        }
      }

      if (fileUpdated > 0) {
        saveCampaignFile(filePath, data);
        logger.info(MODULE, `saved ${path.basename(filePath)} (${fileUpdated} updated)`);
        totalUpdated += fileUpdated;
      }
    }

    return { updated: totalUpdated, newCampaigns };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncA8Affiliates({ headless: false })
    .then(r => logger.info(MODULE, `done — ${r.updated} campaigns updated`))
    .catch(err => { logger.error(MODULE, err.message); process.exit(1); });
}
