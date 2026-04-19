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
import { runReply }                    from '../x/reply.js';
import { runQuoteRT }                  from '../x/quote-rt.js';
import { runNotePromo }                from '../x/note-promo.js';
import { runArticle }                  from '../x/article.js';
import { runResearch as runNoteResearch } from '../note/research.js';
import { runGenerate }                 from '../note/generate.js';
import { runImage as runNoteImage }    from '../note/image.js';
import { runPost as runNotePost }      from '../note/post.js';
import { collectXMetrics }             from '../analytics/collect-x.js';
import { runBuzzAnalysis }             from '../analytics/buzz-analyzer.js';
import { runGenerate as runInstaGenerate } from '../instagram/generate.js';
import { runImage  as runInstaImage }   from '../instagram/image.js';
import { runRender as runInstaRender }  from '../instagram/render.js';
import { runPost   as runInstaPost }    from '../instagram/post.js';
import { logger }                      from '../shared/logger.js';
import { notifyError }                 from '../shared/notify.js';
import { runGenerate as runYtGenerate }       from '../youtube/generate.js';
import { runPlan    as runYtPlan }             from '../youtube/plan.js';
import { runFetch   as runRedditFetch }        from '../youtube/reddit-fetch.js';
import { runGenerate as runRedditGenerate }    from '../youtube/reddit-generate.js';
import { runCheckExpiry as runInstaCheckExpiry } from '../instagram/check-expiry.js';
import { runAIToolsResearch } from '../shared/ai-tools-researcher.js';
import { runRender  as runYtRender }           from '../youtube/render.js';
import { runUpload  as runYtUpload }           from '../youtube/upload.js';
import { runResearch as runGhostResearch }     from '../ghost/research.js';
import { runGenerate as runGhostGenerate }     from '../ghost/generate.js';
import { runPost     as runGhostPost }         from '../ghost/post.js';

const MODULE = 'scheduler';
const MODE   = process.env.MODE ?? 'dev';

const HANDLERS = {
  'x:enqueue':      (task) => enqueue(task.keywords),
  'x:process':      ()     => processQueue({ mode: MODE }),
  'x:like':         (task) => runLike(task.keywords),
  'x:reply':        (task) => runReply(task.keywords),
  'x:quote-rt':     (task) => runQuoteRT(task.keywords),
  'x:note-promo':   ()     => runNotePromo({ mode: MODE }),
  'x:article':      ()     => runArticle(),
  'note:research':  ()     => runNoteResearch(),
  'note:generate':  ()     => runGenerate(),
  'note:image':     ()     => runNoteImage(),
  'note:post':      ()     => runNotePost(),
  'x:collect':               ()     => collectXMetrics(),
  'analytics:buzz':          ()     => runBuzzAnalysis(),
  'instagram:generate:1':    (task) => runInstaGenerate({ account: task.account }),
  'instagram:generate:2':    (task) => runInstaGenerate({ account: task.account }),
  'instagram:image:1':       (task) => runInstaImage({ account: task.account }),
  'instagram:image:2':       (task) => runInstaImage({ account: task.account }),
  'instagram:render:1':      (task) => runInstaRender({ account: task.account }),
  'instagram:render:2':      (task) => runInstaRender({ account: task.account }),
  'instagram:post:1':        (task) => runInstaPost({ account: task.account }),
  'instagram:post:2':        (task) => runInstaPost({ account: task.account }),

  'instagram:check-expiry':  ()     => runInstaCheckExpiry(),

  // YouTube
  'youtube:generate:short':  (task) => runYtGenerate({ type: task.type }),
  'youtube:render:short':    (task) => runYtRender({ type: task.type }),
  'youtube:upload:short':    (task) => runYtUpload({ type: task.type }),
  'youtube:generate:long':   (task) => runYtGenerate({ type: task.type }),
  'youtube:render:long':     (task) => runYtRender({ type: task.type }),
  'youtube:upload:long':              (task) => runYtUpload({ type: task.type }),
  'youtube:plan':                     ()     => runYtPlan(),

  'ghost:research': () => runGhostResearch(),
  'ghost:generate': () => runGhostGenerate(),
  'ghost:post':     () => runGhostPost({ mode: MODE }),

  // Reddit読み上げ
  'youtube:reddit-fetch':             ()     => runRedditFetch(),
  'youtube:reddit-generate':          (task) => runRedditGenerate({ type: task.type }),
  'youtube:render:reddit-short':      (task) => runYtRender({ type: task.type }),
  'youtube:upload:reddit-short':      (task) => runYtUpload({ type: task.type }),
  'research:ai-tools':               ()     => runAIToolsResearch(),
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
        notifyError(`タスク失敗: ${task.name}`, err.message ?? 'エラー詳細なし');
      } finally {
        runningMap.set(task.name, false);
      }
    }, { timezone: 'Asia/Tokyo' });

    logger.info(MODULE, `registered: ${task.name} [${task.cron}]`);
  }
}

// ── PROD 単発実行（Routines 向け）─────────────────────────────────
// MODE=prod + DEV_TASK=xxx の組み合わせで1タスクだけ実行して終了
async function runProdOnce() {
  const target  = process.env.DEV_TASK;
  const task    = TASKS.find(t => t.name === target);
  const handler = HANDLERS[target];

  if (!handler) {
    console.error(`unknown task: ${target}`);
    console.error(`available: ${Object.keys(HANDLERS).join(', ')}`);
    process.exit(1);
  }

  console.log(`PROD MODE (single run) — running: ${target}`);
  logger.info(MODULE, `prod single run: ${target}`);

  try {
    await handler(task ?? {});
    logger.info(MODULE, `prod single run done: ${target}`);
  } catch (err) {
    logger.error(MODULE, `prod single run failed: ${target}`, { message: err.message });
    process.exit(1);
  }
}

// ── エントリポイント ───────────────────────────────────────────────
if (MODE === 'dev') {
  runDev();
} else if (MODE === 'prod') {
  if (process.env.DEV_TASK) {
    runProdOnce();   // Routines: 1タスクだけ実行して終了
  } else {
    runProd();       // ローカル常駐: cron デーモン起動
  }
} else {
  console.error(`unknown MODE: ${MODE}. use MODE=dev or MODE=prod`);
  process.exit(1);
}
