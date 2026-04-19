import { Router } from 'express';
import { logger } from '../../shared/logger.js';

const router = Router();
const MODULE = 'bridge:instagram';

router.post('/generate', async (req, res) => {
  try {
    const account = Number(req.body?.account ?? 1);
    const { runGenerate } = await import('../../instagram/generate.js');
    const draft = await runGenerate({ account });
    res.json({ ok: true, account, draft });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/post', async (req, res) => {
  try {
    const account = Number(req.body?.account ?? 1);
    const { runPost } = await import('../../instagram/post.js');
    const result = await runPost({ account });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/image', async (req, res) => {
  try {
    const account = Number(req.body?.account ?? 1);
    const { runImage } = await import('../../instagram/image.js');
    await runImage({ account });
    res.json({ ok: true, account });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/render', async (req, res) => {
  try {
    const account = Number(req.body?.account ?? 1);
    const { runRender } = await import('../../instagram/render.js');
    const result = await runRender({ account });
    res.json({ ok: true, account, ...result });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/collect', async (_req, res) => {
  try {
    const { runCollect } = await import('../../instagram/collect.js');
    await runCollect();
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
