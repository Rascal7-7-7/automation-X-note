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
import { runRepromo }                  from '../x/note-repromo.js';
import { runRepublishEdits }           from '../note/republish-edits.js';
import { runArticle }                  from '../x/article.js';
import { runXArticle }                 from '../x/x-articles.js';
import { runResearch as runNoteResearch } from '../note/research.js';
import { runGenerate }                 from '../note/generate.js';
import { runImage as runNoteImage }    from '../note/image.js';
import { runPost as runNotePost }      from '../note/post.js';
import { collectXMetrics }             from '../analytics/collect-x.js';
import { collectNoteStats }           from '../analytics/collect-note.js';
import { runCrossLike }               from '../note/cross-like.js';
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
import { runDailyResearch }  from '../analytics/daily-research.js';
import { runAINews }          from '../x/ai-news.js';
import { runSelfReply }      from '../x/self-reply.js';
import { runCheckCredits }   from '../shared/check-anthropic-credits.js';
import { runPendingSelfReplies } from '../x/post-self-reply.js';
import { runCoattailReply }     from '../x/coattail-reply.js';
import { runRender  as runYtRender }           from '../youtube/render.js';
import { runUpload  as runYtUpload }           from '../youtube/upload.js';
import { runCommunityPost as runYtCommunityPost } from '../youtube/community-post.js';
import { runPostCommunity as runYtPostCommunity } from '../youtube/post-community.js';
import { runResearch as runGhostResearch }     from '../ghost/research.js';
import { runGenerate as runGhostGenerate }     from '../ghost/generate.js';
import { runPost     as runGhostPost }         from '../ghost/post.js';
import { spawn } from 'child_process';

const MODULE = 'scheduler';
const MODE   = process.env.MODE ?? 'dev';

const HANDLERS = {
  'x:enqueue':      (task) => enqueue(task.keywords),
  'x:process':      ()     => processQueue({ mode: MODE }),
  'x:like':         (task) => runLike(task?.keywords ?? ['AI活用', 'Claude Code']),
  'x:reply':        (task) => runReply(task?.keywords ?? ['AI活用', 'Claude Code']),
  'x:quote-rt':     (task) => runQuoteRT(task?.keywords ?? ['AI活用', 'Claude Code']),
  'x:note-promo':   ()     => runNotePromo({ mode: MODE }),
  'note:repromo':          ()     => runRepromo({ mode: MODE }),
  'note:republish-edits':  ()     => runRepublishEdits(),
  'x:article':      ()     => runArticle(),
  'x:x-article':   ()     => runXArticle(),
  'note:research':  (task) => runNoteResearch(task.account ?? 1),
  'note:generate':  (task) => runGenerate(undefined, task.account ?? 1),
  'note:image':     (task) => runNoteImage(task.account ?? 1),
  'note:post':      (task) => runNotePost(task.account ?? 1),
  'x:collect':               ()     => collectXMetrics(),
  'note:collect':            ()     => collectNoteStats(),
  'note:cross-like':         ()     => runCrossLike(),
  'analytics:buzz':          ()     => runBuzzAnalysis(),
  'instagram:generate:1':    (task) => runInstaGenerate({ account: task.account }),
  'instagram:generate:2':    (task) => runInstaGenerate({ account: task.account }),
  'instagram:image:1':       (task) => runInstaImage({ account: task.account }),
  'instagram:image:2':       (task) => runInstaImage({ account: task.account }),
  'instagram:render:1':      (task) => runInstaRender({ account: task.account }),
  'instagram:render:2':      (task) => runInstaRender({ account: task.account }),
  'instagram:post-image:1':  (task) => runInstaPost({ account: task.account, type: 'image' }),
  'instagram:post-image:2':  (task) => runInstaPost({ account: task.account, type: 'image' }),
  'instagram:post-reels:1':  (task) => runInstaPost({ account: task.account, type: 'reels' }),
  'instagram:post-reels:2':  (task) => runInstaPost({ account: task.account, type: 'reels' }),

  'instagram:check-expiry':  ()     => runInstaCheckExpiry(),

  // YouTube
  'youtube:generate:breaking-short': (task) => runYtGenerate({ type: task.type }),
  'youtube:render:breaking-short':   (task) => runYtRender({ type: 'short' }),
  'youtube:upload:breaking-short':   (task) => runYtUpload({ type: 'short' }),
  'youtube:generate:short':  (task) => runYtGenerate({ type: task.type }),
  'youtube:render:short':    (task) => runYtRender({ type: task.type }),
  'youtube:upload:short':    (task) => runYtUpload({ type: task.type }),
  'youtube:generate:long':             (task) => runYtGenerate({ type: task.type }),
  'youtube:render:long':               (task) => runYtRender({ type: task.type }),
  'youtube:upload:long':               (task) => runYtUpload({ type: task.type }),
  'youtube:generate:chatgpt-short':    (task) => runYtGenerate({ type: task.type }),
  'youtube:render:chatgpt-short':      (task) => runYtRender({ type: task.type }),
  'youtube:upload:chatgpt-short':      (task) => runYtUpload({ type: task.type }),
  'youtube:generate:anime-short':      (task) => runYtGenerate({ type: task.type }),
  'youtube:render:anime-short':        (task) => runYtRender({ type: task.type }),
  'youtube:upload:anime-short':        (task) => runYtUpload({ type: task.type }),
  'youtube:plan':                     ()     => runYtPlan(),
  'youtube:community-post':           ()     => runYtCommunityPost(),
  'youtube:post-community':           ()     => runYtPostCommunity(),

  'ghost:research': () => runGhostResearch(),
  'ghost:generate': () => runGhostGenerate(),
  'ghost:post':     () => runGhostPost({ mode: MODE }),

  // Reddit読み上げ
  'youtube:reddit-fetch':             ()     => runRedditFetch(),
  'youtube:reddit-generate':          (task) => runRedditGenerate({ type: task.type }),
  'youtube:render:reddit-short':      (task) => runYtRender({ type: task.type }),
  'youtube:upload:reddit-short':      (task) => runYtUpload({ type: task.type }),
  'research:ai-tools':               ()     => runAIToolsResearch(),
  'analytics:daily-research':        ()     => runDailyResearch(),
  'x:self-reply':             () => runSelfReply(),
  'x:post-self-reply':        () => runPendingSelfReplies(),
  'x:coattail-reply':         () => runCoattailReply(),
  'anthropic:check-credits': () => runCheckCredits(),
  'x:midday': async () => {
    // 昼ピーク枠: AI tips/数値実績ツイート（x:ai-newsと同ロジック・別トピック）
    await runAINews();
  },

  'x:ai-news':                       async () => {
    await runAINews();
    // runQuoteRT は Brave CDP が必要 — 未起動時は警告のみ（AI news 投稿失敗扱いにしない）
    try {
      await runQuoteRT(['AI', 'ChatGPT', 'Claude', '生成AI', 'OpenAI', 'Gemini'], { maxPerRun: 2 });
    } catch (e) {
      logger.warn('x:ai-news', `runQuoteRT skipped — ${e.message}`);
    }
  },

  'dashboard:push-to-neon': () => new Promise((resolve, reject) => {
    const proc = spawn('node', ['/Users/Rascal/work/automation/dashboard-v2/scripts/push-to-neon.mjs'], { stdio: 'inherit' });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  }),

  'monitoring:health-check': () => new Promise((resolve, reject) => {
    const proc = spawn('node', ['/Users/Rascal/work/automation/monitoring/health-check.js'], { stdio: 'inherit' });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  }),
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
// モジュールレベルで保持 → runProd() を複数回呼んでも重複登録しない
const _runningMap  = new Map();
const _scheduledJobs = new Map();

function runProd() {
  console.log('PROD MODE — cron start');

  for (const task of TASKS) {
    const handler = HANDLERS[task.name];
    if (!handler) {
      logger.warn(MODULE, `no handler: ${task.name}`);
      continue;
    }

    // account付きユニークキー → 同名タスク（note:research×3等）を別ジョブとして管理
    const jobKey = task.account != null
      ? `${task.name}:${task.account}`
      : task.slot != null
        ? `${task.name}:${task.slot}`
        : task.name;

    // 既存ジョブを停止してから再登録（多重登録防止）
    if (_scheduledJobs.has(jobKey)) {
      _scheduledJobs.get(jobKey).stop();
      logger.info(MODULE, `re-registering: ${jobKey}`);
    }

    _runningMap.set(jobKey, false);

    const job = cron.schedule(task.cron, async () => {
      if (_runningMap.get(jobKey)) {
        logger.warn(MODULE, `SKIP (already running): ${jobKey}`);
        return;
      }

      _runningMap.set(jobKey, true);
      logger.info(MODULE, `START ${task.name}`);

      try {
        await handler(task);
        logger.info(MODULE, `DONE  ${task.name}`);
      } catch (err) {
        logger.error(MODULE, `FAIL  ${task.name}`, { message: err.message });
        await notifyError(`タスク失敗: ${task.name}`, err.message ?? 'エラー詳細なし');
      } finally {
        _runningMap.set(jobKey, false);
      }
    }, { timezone: 'Asia/Tokyo' });

    _scheduledJobs.set(jobKey, job);
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
