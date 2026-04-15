/**
 * YouTube Analytics 収集モジュール
 *
 * YouTube Analytics API v2 で動画ごとの指標を収集し
 * youtube/analytics/{date}.json に保存する
 *
 * 収集指標:
 *   - 視聴回数（views）
 *   - 再生時間（estimatedMinutesWatched）
 *   - 視聴維持率（averageViewPercentage）
 *   - クリック率（cardClickRate）
 *   - チャンネル登録者増減（subscribersGained / subscribersLost）
 *   - いいね数（likes）
 *   - コメント数（comments）
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/logger.js';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const ANALYTICS_DIR  = path.join(__dirname, 'analytics');
const DRAFTS_DIR     = path.join(__dirname, 'drafts');
const MODULE         = 'youtube:collect';

const YT_ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const TOKEN_URL    = 'https://oauth2.googleapis.com/token';

const {
  YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET,
  YOUTUBE_REFRESH_TOKEN,
  YOUTUBE_CHANNEL_ID,
} = process.env;

// ── メイン ──────────────────────────────────────────────────────────

export async function runCollect() {
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    logger.warn(MODULE, 'YouTube credentials not set — skipping collect');
    return { collected: false, reason: 'credentials not set' };
  }

  const today    = new Date().toISOString().split('T')[0];
  const since    = getDateDaysAgo(30);

  if (!fs.existsSync(ANALYTICS_DIR)) fs.mkdirSync(ANALYTICS_DIR, { recursive: true });

  try {
    const accessToken = await refreshAccessToken();
    const metrics     = await fetchAnalytics(accessToken, since, today);
    const videoIds    = collectUploadedVideoIds();
    const perVideo    = videoIds.length > 0
      ? await fetchPerVideoAnalytics(accessToken, videoIds, since, today)
      : [];

    const report = {
      date:     today,
      period:   { since, until: today },
      channel:  metrics,
      videos:   perVideo,
      createdAt: new Date().toISOString(),
    };

    const reportPath = path.join(ANALYTICS_DIR, `${today}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    logger.info(MODULE, `analytics saved → ${reportPath}`);

    return { collected: true, report };
  } catch (err) {
    logger.error(MODULE, `collect error: ${err.message}`);
    return { collected: false, reason: err.message };
  }
}

// ── Analytics API ────────────────────────────────────────────────────

async function fetchAnalytics(accessToken, startDate, endDate) {
  const channelId = YOUTUBE_CHANNEL_ID ? `channel==${YOUTUBE_CHANNEL_ID}` : 'channel==MINE';
  const params    = new URLSearchParams({
    ids:        channelId,
    startDate,
    endDate,
    metrics:    'views,estimatedMinutesWatched,averageViewPercentage,subscribersGained,subscribersLost,likes,comments',
    dimensions: 'day',
    sort:       'day',
  });

  const res  = await fetch(`${YT_ANALYTICS}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  if (data.error) throw new Error(`Analytics API error: ${data.error.message}`);

  return parseRows(data);
}

async function fetchPerVideoAnalytics(accessToken, videoIds, startDate, endDate) {
  const results = [];
  const channelId = YOUTUBE_CHANNEL_ID ? `channel==${YOUTUBE_CHANNEL_ID}` : 'channel==MINE';

  for (const videoId of videoIds.slice(0, 20)) {
    const params = new URLSearchParams({
      ids:       channelId,
      startDate,
      endDate,
      metrics:   'views,estimatedMinutesWatched,averageViewPercentage,likes,comments',
      filters:   `video==${videoId}`,
    });

    const res  = await fetch(`${YT_ANALYTICS}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    if (!data.error) {
      results.push({ videoId, ...parseRows(data) });
    }
    await sleep(200); // レート制限対策
  }

  return results;
}

// ── ヘルパー ─────────────────────────────────────────────────────────

function refreshAccessToken() {
  return fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      refresh_token: YOUTUBE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  })
    .then(r => r.json())
    .then(d => {
      if (!d.access_token) throw new Error(`token refresh failed: ${JSON.stringify(d)}`);
      return d.access_token;
    });
}

function parseRows(data) {
  if (!data.rows || !data.columnHeaders) return {};
  const headers = data.columnHeaders.map(h => h.name);
  const totals  = {};
  for (const row of data.rows) {
    row.forEach((val, i) => {
      if (i === 0) return; // day カラムはスキップ
      const key = headers[i];
      totals[key] = (totals[key] ?? 0) + (typeof val === 'number' ? val : 0);
    });
  }
  return totals;
}

/** drafts/ から upload 済みの videoId を収集 */
function collectUploadedVideoIds() {
  if (!fs.existsSync(DRAFTS_DIR)) return [];
  const ids = [];
  for (const dateDir of fs.readdirSync(DRAFTS_DIR)) {
    for (const file of ['short.json', 'long.json']) {
      const p = path.join(DRAFTS_DIR, dateDir, file);
      if (!fs.existsSync(p)) continue;
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (d.videoId) ids.push(d.videoId);
      } catch { /* skip */ }
    }
  }
  return [...new Set(ids)];
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCollect();
}
