/**
 * A8.net 承認済み案件の自動URL同期
 * - A8.netにログインして承認済み案件一覧を取得
 * - ghost/asp-campaigns.json と instagram/asp-campaigns.json を更新
 * - 案件名マッチ（部分一致・大文字小文字無視）でURLを自動セット
 * - active: true は URL がセットされた時点で自動設定
 */
import 'dotenv/config';
import fs from 'fs';
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

const A8_LOGIN_URL = 'https://www.a8.net/a8v2/login.html';
const A8_PROGRAMS_URL = 'https://www.a8.net/a8v2/asMyProgramList.html';

function loadCampaignFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveCampaignFile(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
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
  await page.goto(A8_PROGRAMS_URL, { waitUntil: 'domcontentloaded' });
  const programs = [];
  let hasNext = true;

  while (hasNext) {
    // 各行を取得（A8.netのHTML構造に合わせてセレクタ調整が必要な場合あり）
    const rows = page.locator('table tr').filter({ hasText: '提携中' });
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const name = await getTextSafe(row.locator('td').nth(1));
      const detailLink = row.locator('a').first();
      const detailUrl = await getAttrSafe(detailLink, 'href');
      if (name) programs.push({ name, detailUrl });
    }

    const nextBtn = page.locator('a.next, .pagination a[rel="next"]').first();
    if (await nextBtn.count() > 0 && await nextBtn.isEnabled()) {
      await nextBtn.click();
      await page.waitForLoadState('domcontentloaded');
    } else {
      hasNext = false;
    }
  }

  return programs;
}

async function extractAffiliateUrl(page, detailUrl) {
  if (!detailUrl) return null;
  try {
    const fullUrl = detailUrl.startsWith('http') ? detailUrl : `https://www.a8.net${detailUrl}`;
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });

    // px.a8.net 形式のURLをinput or linkから取得
    const inputLocator = page.locator('input').filter({ hasText: '' }).first();
    const linkLocator = page.locator('a[href*="px.a8.net"]').first();

    if (await linkLocator.count() > 0) {
      return await getAttrSafe(linkLocator, 'href');
    }

    // inputのvalueを取得（PlaywrightはinputValue()を使う）
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      const val = await inputs.nth(i).inputValue().catch(() => '');
      if (val.includes('px.a8.net')) return val;
    }

    return null;
  } catch {
    return null;
  }
}

export async function syncA8Affiliates(opts = {}) {
  const email = process.env.A8_EMAIL;
  const password = process.env.A8_PASSWORD;
  if (!email || !password) throw new Error('A8_EMAIL and A8_PASSWORD required in .env');

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
    await page.locator('input[name="login_id"], input[type="email"]').first().fill(email);
    await page.locator('input[name="password"], input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    if (await page.locator('text=ログインIDまたはパスワード').count() > 0) {
      throw new Error('A8.net login failed — check A8_EMAIL / A8_PASSWORD in .env');
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
