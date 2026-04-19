import { Router } from 'express';
import { logger } from '../../shared/logger.js';

const router = Router();
const MODULE = 'bridge:ghost';

router.post('/research', async (_req, res) => {
  try {
    const { runResearch } = await import('../../ghost/research.js');
    const posts = await runResearch();
    res.json({ ok: true, count: posts.length });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/generate', async (_req, res) => {
  try {
    const { runGenerate } = await import('../../ghost/generate.js');
    const draft = await runGenerate();
    res.json({ ok: true, draft });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/translate', async (_req, res) => {
  try {
    const { runTranslate } = await import('../../ghost/translate.js');
    const draft = await runTranslate();
    res.json({ ok: true, draft });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/post', async (req, res) => {
  try {
    const { runPost } = await import('../../ghost/post.js');
    const result = await runPost({ mode: req.body?.mode });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/sync-affiliates', async (_req, res) => {
  try {
    const { syncA8Affiliates } = await import('../../shared/sync-a8-affiliates.js');
    const { triggerAffiliateContent } = await import('../../shared/affiliate-content-trigger.js');
    const syncResult = await syncA8Affiliates({ headless: true });
    let contentResult = { note: 0, instagram: 0 };
    if (syncResult.newCampaigns?.length) {
      contentResult = await triggerAffiliateContent(syncResult.newCampaigns);
    }
    res.json({ ok: true, ...syncResult, content: contentResult });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
