/**
 * スケジューラ
 *
 * MODE=dev  → DEV_TASK で指定したタスクを1回だけ実行して終了
 * MODE=prod → 全タスクを cron で常時稼働（同時実行防止付き）
 */
import 'dotenv/config';
import cron from 'node-cron';
import { TASKS } from './tasks.js';
import { enqueue, processQueue }       from '../x/pipeline.js';
import { runLike }                     from '../x/like.js';
import { runNotePromo }                from '../x/note-promo.js';
import { runResearch as runNoteResearch } from '../note/research.js';
import { runGenerate }                 from '../note/generate.js';
import { runImage as runNoteImage }    from '../note/image.js';
import { runPost as runNotePost }      from '../note/post.js';
import { collectXMetrics }             from '../analytics/collect-x.js';
import { runBuzzAnalysis }             from '../analytics/buzz-analyzer.js';
import { logger }                      from '../shared/logger.js';

const MODULE = 'scheduler';
const MODE   = process.env.MODE ?? 'dev';

const HANDLERS = {
  'x:enqueue':      (task) => enqueue(task.keywords),
  'x:process':      ()     => processQueue({ mode: MODE }),
  'x:like':         (task) => runLike(task.keywords),
  'x:note-promo':   ()     => runNotePromo({ mode: MODE }),
  'note:research':  ()     => runNoteResearch(),
  'note:generate':  ()     => runGenerate(),
  'note:image':     ()     => runNoteImage(),
  'note:post':      ()     => runNotePost(),
  'x:collect':      ()     => collectXMetrics(),
  'analytics:buzz': ()     => runBuzzAnalysis(),
};

// ── DEV MODE ──────────────────────────────────────────────────────
async function runDev() {
  const target  = process.env.DEV_TASK ?? 'x:enqueue';
  const task    = TASKS.find(t => t.name === target);
  const handler = HANDLERS[target];

  if (!handler) {
    console.error(`unknown task: ${target}`);
    console.error(`available: ${Object.keys(HANDLERS).join(', ')}`);
    process.exit(1);
  }

  console.log(`DEV MODE — running: ${target}`);
  logger.info(MODULE, `dev run: ${target}`);

  try {
    await handler(task ?? {});
    logger.info(MODULE, `dev run done: ${target}`);
  } catch (err) {
    logger.error(MODULE, `dev run failed: ${target}`, { message: err.message });
    process.exit(1);
  }
}

// ── PROD MODE ──────────────────────────────────────────────────────
function runProd() {
  console.log('PROD MODE — cron start');

  const runningMap = new Map();

  for (const task of TASKS) {
    const handler = HANDLERS[task.name];
    if (!handler) {
      logger.warn(MODULE, `no handler: ${task.name}`);
      continue;
    }

    runningMap.set(task.name, false);

    cron.schedule(task.cron, async () => {
      if (runningMap.get(task.name)) {
        logger.warn(MODULE, `SKIP (already running): ${task.name}`);
        return;
      }

      runningMap.set(task.name, true);
      logger.info(MODULE, `START ${task.name}`);

      try {
        await handler(task);
        logger.info(MODULE, `DONE  ${task.name}`);
      } catch (err) {
        logger.error(MODULE, `FAIL  ${task.name}`, { message: err.message });
      } finally {
        runningMap.set(task.name, false);
      }
    }, { timezone: 'Asia/Tokyo' });

    logger.info(MODULE, `registered: ${task.name} [${task.cron}]`);
  }
}

// ── エントリポイント ───────────────────────────────────────────────
if (MODE === 'dev') {
  runDev();
} else if (MODE === 'prod') {
  runProd();
} else {
  console.error(`unknown MODE: ${MODE}. use MODE=dev or MODE=prod`);
  process.exit(1);
}
