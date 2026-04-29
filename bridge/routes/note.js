import { Router } from 'express';
import { logger } from '../../shared/logger.js';

const router = Router();
const MODULE = 'bridge:note';

router.post('/research', async (req, res) => {
  try {
    const accountId = Number(req.body?.accountId ?? 1);
    const { runResearch } = await import('../../note/research.js');
    await runResearch(accountId);
    res.json({ ok: true, accountId });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const accountId = Number(req.body?.accountId ?? 1);
    const theme = req.body?.theme ?? undefined;
    const { runGenerate } = await import('../../note/generate.js');
    await runGenerate(theme, accountId);
    res.json({ ok: true, accountId });
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

router.post('/post', async (req, res) => {
  try {
    const accountId = Number(req.body?.account ?? req.body?.accountId ?? 1);
    const { runPost } = await import('../../note/post.js');
    await runPost({ accountId, mode: 'prod' });
    res.json({ ok: true, accountId });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/publish', async (req, res) => {
  try {
    const draftId   = req.body?.draftId   ?? null;
    const accountId = Number(req.body?.accountId ?? 1);
    if (!draftId || typeof draftId !== 'string') {
      return res.status(400).json({ ok: false, error: 'draftId required' });
    }
    const { runPost } = await import('../../note/post.js');
    const result = await runPost({ accountId, draftId, mode: 'prod' });
    res.json({ ok: true, publishedUrl: result?.noteUrl ?? null });
  } catch (err) {
    logger.error(MODULE, 'note publish failed', { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
