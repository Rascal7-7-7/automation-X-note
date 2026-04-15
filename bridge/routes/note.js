import { Router } from 'express';
import { logger } from '../../shared/logger.js';

const router = Router();
const MODULE = 'bridge:note';

router.post('/research', async (_req, res) => {
  try {
    const { runResearch } = await import('../../note/research.js');
    await runResearch();
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/generate', async (_req, res) => {
  try {
    const { runGenerate } = await import('../../note/generate.js');
    await runGenerate();
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/image', async (_req, res) => {
  try {
    const { runImage } = await import('../../note/image.js');
    await runImage();
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/post', async (_req, res) => {
  try {
    const { runPost } = await import('../../note/post.js');
    await runPost();
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
