import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../shared/logger.js';

const router = Router();
const MODULE = 'bridge:analytics';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR  = path.join(__dirname, '../../logs');

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

// GET /api/analytics/status — モジュール別ヘルス（直近24h エラー集計）
router.get('/status', (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOGS_DIR, `${today}.log`);
    if (!fs.existsSync(logFile)) return res.json({ ok: true, modules: {}, note: 'no log yet' });

    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const modules = {};
    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        const mod = d.module ?? 'unknown';
        if (!modules[mod]) modules[mod] = { errors: 0, warns: 0, lastError: null };
        if (d.level === 'ERROR') {
          modules[mod].errors++;
          modules[mod].lastError = d.message?.slice(0, 80) ?? null;
        } else if (d.level === 'WARN') {
          modules[mod].warns++;
        }
      } catch { /* skip */ }
    }

    const degraded = Object.entries(modules)
      .filter(([, v]) => v.errors > 0)
      .sort(([, a], [, b]) => b.errors - a.errors)
      .map(([mod, v]) => ({ mod, ...v }));

    res.json({ ok: true, date: today, degraded, allModules: modules });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/daily-research', async (_req, res) => {
  try {
    const { runDailyResearch } = await import('../../analytics/daily-research.js');
    const result = await runDailyResearch();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
