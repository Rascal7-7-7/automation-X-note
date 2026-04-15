/**
 * Bridge Route: YouTube
 *
 * POST /api/youtube/research  — Playwright でトレンド収集
 * POST /api/youtube/generate  — 台本・メタデータ生成（type: short|long）
 * POST /api/youtube/upload    — YouTube Data API v3 でアップロード
 * POST /api/youtube/collect   — YouTube Analytics 収集
 */
import { Router } from 'express';
import { logger } from '../../shared/logger.js';

const router = Router();
const MODULE = 'bridge:youtube';

router.post('/research', async (_req, res) => {
  try {
    const { runResearch } = await import('../../youtube/research.js');
    const result = await runResearch();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { type = 'short', topic } = req.body ?? {};
    const { runGenerate } = await import('../../youtube/generate.js');
    const draft = await runGenerate({ type, topic });
    res.json({ ok: true, draft });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/upload', async (req, res) => {
  try {
    const { type = 'short', videoPath } = req.body ?? {};
    const { runUpload } = await import('../../youtube/upload.js');
    const result = await runUpload({ type, videoPath });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/render', async (req, res) => {
  try {
    const { type = 'short', date } = req.body ?? {};
    const { runRender } = await import('../../youtube/render.js');
    const result = await runRender({ type, date });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/collect', async (_req, res) => {
  try {
    const { runCollect } = await import('../../youtube/collect.js');
    const result = await runCollect();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
