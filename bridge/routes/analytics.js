import { Router } from 'express';
import { logger } from '../../shared/logger.js';

const router = Router();
const MODULE = 'bridge:analytics';

router.post('/collect-x', async (_req, res) => {
  try {
    const { collectXMetrics } = await import('../../analytics/collect-x.js');
    await collectXMetrics();
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/buzz', async (_req, res) => {
  try {
    const { runBuzzAnalysis } = await import('../../analytics/buzz-analyzer.js');
    await runBuzzAnalysis();
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/ai-tools', async (_req, res) => {
  try {
    const { runAIToolsResearch } = await import('../../shared/ai-tools-researcher.js');
    const result = await runAIToolsResearch();
    res.json({ ok: true, filename: result.filename });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
