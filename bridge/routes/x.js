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
    logger.error(MODULE, 'x research failed', { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/process', async (_req, res) => {
  try {
    const { processQueue } = await import('../../x/pipeline.js');
    await processQueue({ mode: 'prod' });
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, 'x process queue failed', { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/like', async (_req, res) => {
  try {
    const { runLike } = await import('../../x/like.js');
    await runLike(LIKE_KEYWORDS);
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, 'x like failed', { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/note-promo', async (_req, res) => {
  try {
    const { runNotePromo } = await import('../../x/note-promo.js');
    await runNotePromo({ mode: 'prod' });
    res.json({ ok: true });
  } catch (err) {
    logger.error(MODULE, 'note promo failed', { message: err.message });
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
    logger.error(MODULE, 'x reply failed', { message: err.message });
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
    logger.error(MODULE, 'x quote-rt failed', { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/x/follow-quote-rt — フォロー中のバズ投稿を引用RT
router.post('/follow-quote-rt', async (req, res) => {
  try {
    const { runFollowQuoteRT } = await import('../../x/follow-quote-rt.js');
    const result = await runFollowQuoteRT(req.body ?? {});
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, 'x follow-quote-rt failed', { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/x/github-intro — GitHub AI系トレンドリポジトリ紹介投稿
router.post('/github-intro', async (req, res) => {
  try {
    const { runGithubIntro } = await import('../../x/github-intro.js');
    const result = await runGithubIntro(req.body ?? {});
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, 'x github intro failed', { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/x/x-article — X Articles長文記事自動投稿（画像+note CTA）
router.post('/x-article', async (_req, res) => {
  try {
    const { runXArticle } = await import('../../x/x-articles.js');
    const result = await runXArticle();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(MODULE, 'x article failed', { message: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
