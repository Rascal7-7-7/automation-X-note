/**
 * Bridge Server
 * n8n から既存の automation スクリプトを HTTP 経由で呼び出すためのラッパー
 * Port: 3001 (n8n は 5678)
 */
import 'dotenv/config';
import express from 'express';
import { logger } from '../shared/logger.js';
import xRouter from './routes/x.js';
import noteRouter from './routes/note.js';
import instaRouter from './routes/instagram.js';
import analyticsRouter from './routes/analytics.js';
import youtubeRouter from './routes/youtube.js';
import ghostRouter from './routes/ghost.js';

const app = express();
const PORT = process.env.BRIDGE_PORT ?? 3001;

app.use(express.json());

app.use('/api/x',         xRouter);
app.use('/api/note',      noteRouter);
app.use('/api/instagram', instaRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/youtube',   youtubeRouter);
app.use('/api/ghost',     ghostRouter);

app.get('/health', (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// 404
app.use((_req, res) =>
  res.status(404).json({ ok: false, error: 'not found' })
);

app.listen(PORT, () =>
  logger.info('bridge', `Bridge server listening on http://localhost:${PORT}`)
);
