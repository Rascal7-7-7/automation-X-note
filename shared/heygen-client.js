/**
 * HeyGen API Client
 * Wraps HeyGen v3 API for avatar video generation
 * Used by YouTube Shorts and Instagram Reels pipelines
 *
 * Required env: HEYGEN_API_KEY
 *
 * Docs: https://developers.heygen.com/reference
 */
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { logger } from './logger.js';

const MODULE = 'heygen-client';
const BASE_URL = 'https://api.heygen.com/v3';

/** @returns {string} API key or throws if missing */
function getApiKey() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    throw new Error('HEYGEN_API_KEY is not set. Add it to your .env file.');
  }
  return key;
}

/** @returns {boolean} true if HEYGEN_API_KEY is configured */
export function isHeyGenAvailable() {
  return Boolean(process.env.HEYGEN_API_KEY);
}

/**
 * Make an authenticated request to the HeyGen v3 API.
 * @param {string} endpoint - Path relative to BASE_URL (e.g. '/videos')
 * @param {object} options - fetch options
 * @returns {Promise<object>} Parsed JSON response
 */
async function request(endpoint, options = {}) {
  const apiKey = getApiKey();
  const url = `${BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HeyGen API error ${res.status} ${res.statusText}: ${body}`);
  }

  return res.json();
}

/**
 * Create an avatar video from a text script.
 * Polls until the video is complete (max 10 minutes).
 *
 * @param {object} params
 * @param {string} params.script         - Text the avatar will speak
 * @param {string} [params.avatarId]     - HeyGen avatar ID (uses first available if omitted)
 * @param {string} [params.voiceId]      - HeyGen voice ID (uses avatar default if omitted)
 * @param {'9:16'|'16:9'} [params.aspectRatio='9:16'] - Video aspect ratio
 * @param {'720p'|'1080p'|'4k'} [params.resolution='1080p'] - Output resolution
 * @returns {Promise<{videoId: string, videoUrl: string, thumbnailUrl: string, duration: number}>}
 */
export async function generateAvatarVideo({
  script,
  avatarId,
  voiceId,
  aspectRatio = '9:16',
  resolution = '1080p',
}) {
  if (!script || script.trim().length === 0) {
    throw new Error('script is required and must not be empty');
  }

  const body = {
    type: 'avatar',
    avatar_id: avatarId,
    script: script.trim(),
    aspect_ratio: aspectRatio,
    resolution,
  };

  if (voiceId) {
    body.voice_id = voiceId;
  }

  if (!body.avatar_id) {
    logger.info(MODULE, 'avatarId not specified, fetching first available avatar...');
    const avatars = await listAvatars();
    if (avatars.length === 0) {
      throw new Error('No avatars available in this HeyGen account');
    }
    body.avatar_id = avatars[0].avatar_id;
    logger.info(MODULE, `using avatar: ${avatars[0].avatar_name ?? body.avatar_id}`);
  }

  logger.info(MODULE, `creating avatar video (aspect=${aspectRatio}, resolution=${resolution})...`);

  const createRes = await request('/videos', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const videoId = createRes?.data?.video_id;
  if (!videoId) {
    throw new Error(`Unexpected response from HeyGen /videos: ${JSON.stringify(createRes)}`);
  }

  logger.info(MODULE, `video created, id=${videoId} — polling for completion...`);

  const videoUrl = await pollVideoCompletion(videoId);
  const statusRes = await request(`/videos/${videoId}`);
  const data = statusRes?.data ?? {};

  return {
    videoId,
    videoUrl,
    thumbnailUrl: data.thumbnail_url ?? null,
    duration: data.duration ?? null,
  };
}

/**
 * Poll video status until completed or failed.
 * @param {string} videoId
 * @param {number} [maxWaitMs=600000] - Max wait time in milliseconds (default 10 min)
 * @returns {Promise<string>} video URL when ready
 */
async function pollVideoCompletion(videoId, maxWaitMs = 600_000) {
  const started = Date.now();
  let intervalMs = 5_000;

  while (Date.now() - started < maxWaitMs) {
    await sleep(intervalMs);

    const res = await request(`/videos/${videoId}`);
    const data = res?.data ?? {};
    const status = data.status;

    logger.info(MODULE, `video ${videoId} status: ${status}`);

    if (status === 'completed') {
      if (!data.video_url) {
        throw new Error(`HeyGen video ${videoId} completed but video_url is missing`);
      }
      return data.video_url;
    }

    if (status === 'failed') {
      const reason = data.error ?? JSON.stringify(data);
      throw new Error(`HeyGen video ${videoId} failed: ${reason}`);
    }

    // Backoff: ramp from 5s to 15s after first minute
    if (Date.now() - started > 60_000) {
      intervalMs = 15_000;
    }
  }

  throw new Error(`HeyGen video ${videoId} did not complete within ${maxWaitMs / 1000}s`);
}

/**
 * Download a video from a URL to a local file path.
 * @param {string} videoUrl  - HTTPS URL of the video
 * @param {string} outputPath - Absolute local file path to save to
 * @returns {Promise<void>}
 */
export async function downloadVideo(videoUrl, outputPath) {
  if (!videoUrl) throw new Error('videoUrl is required');
  if (!outputPath) throw new Error('outputPath is required');

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  logger.info(MODULE, `downloading video → ${outputPath}`);

  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Failed to download video: ${res.status} ${res.statusText}`);
  }

  await pipeline(res.body, createWriteStream(outputPath));
  logger.info(MODULE, `download complete: ${outputPath}`);
}

/**
 * List available avatars in the account.
 * @returns {Promise<Array<{avatar_id: string, avatar_name: string}>>}
 */
export async function listAvatars() {
  const res = await request('/avatars');
  const items = res?.data ?? res?.avatars ?? [];

  // v3 returns avatar groups; flatten to individual avatars
  const avatars = [];
  for (const group of items) {
    if (group.avatar_id) {
      avatars.push({
        avatar_id: group.avatar_id,
        avatar_name: group.avatar_name ?? group.name ?? group.avatar_id,
      });
    }
    if (Array.isArray(group.looks)) {
      for (const look of group.looks) {
        avatars.push({
          avatar_id: look.look_id ?? look.avatar_id,
          avatar_name: `${group.avatar_name ?? group.name} - ${look.name ?? look.look_id}`,
        });
      }
    }
  }

  return avatars;
}

/**
 * List available voices, optionally filtered by language.
 * @param {string} [language='Japanese'] - Language filter (HeyGen uses English language names)
 * @returns {Promise<Array<{voice_id: string, name: string, language: string, gender: string}>>}
 */
export async function listVoices(language = 'Japanese') {
  const params = new URLSearchParams({ limit: '100' });
  if (language) params.set('language', language);

  const res = await request(`/voices?${params}`);
  const items = res?.data ?? [];

  return items.map(v => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language,
    gender: v.gender,
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
