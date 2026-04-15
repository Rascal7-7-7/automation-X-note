import { Router } from 'express';
import { logger } from '../../shared/logger.js';

const router = Router();
const MODULE = 'bridge:x';

// 既存 tasks.js の keywords と同じデフォルト値
const LIKE_KEYWORDS = ['AI活用', 'Claude', '個人開発', '副業エンジニア', 'NISA', '投資'];

router.post('/research', async (_req, res) => {
  try {
    const { enqueue } = await import('../../x/pipeline.js');
    await enqueue(null); // null = 全ドメイン
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/process', async (_req, res) => {
  try {
    const { processQueue } = await import('../../x/pipeline.js');
    await processQueue({ mode: 'prod' });
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/like', async (_req, res) => {
  try {
    const { runLike } = await import('../../x/like.js');
    await runLike(LIKE_KEYWORDS);
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/note-promo', async (_req, res) => {
  try {
    const { runNotePromo } = await import('../../x/note-promo.js');
    await runNotePromo({ mode: 'prod' });
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/reply', async (req, res) => {
  try {
    const { runReply } = await import('../../x/reply.js');
    const keywords = req.body?.keywords ?? LIKE_KEYWORDS;
    await runReply(keywords);
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/quote-rt', async (req, res) => {
  try {
    const { runQuoteRT } = await import('../../x/quote-rt.js');
    const keywords = req.body?.keywords ?? LIKE_KEYWORDS;
    await runQuoteRT(keywords);
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
