// Routinesで管理するタスク（リモート実行・Mac不要）:
//   X投稿/いいね/リプライ/引用RT、note生成/投稿、Instagram生成/投稿、X Analytics
// ローカルschedulerはMac必須タスク（YouTube動画生成・アップロード）のみを担当

export const TASKS = [
  // ── X スレッド記事（Routineなし・火・木 週2回） ──────────────────
  {
    name: 'x:article',
    cron: '0 7 * * 2,4',           // 火・木 07:00 — スレッド記事投稿
  },

  // ── X Articles 長文記事（月・金 週2回） ─────────────────────────
  {
    name: 'x:x-article',
    cron: '0 9 * * 1,5',           // 月・金 09:00 — 画像+note CTA付き長文記事
  },

  // ── Instagram — 停止中（2026-04-30 X/note集中戦略に切替） ────────────
  // { name: 'instagram:check-expiry',   cron: '0 9 * * *' },
  // { name: 'instagram:generate:1',     account: 1, cron: '0 19 * * 2,4,6' },
  // { name: 'instagram:image:1',        account: 1, cron: '10 19 * * 2,4,6' },
  // { name: 'instagram:render:1',       account: 1, cron: '25 19 * * 2,4,6' },
  // { name: 'instagram:post-image:1',   account: 1, cron: '45 19 * * 2,4,6' },
  // { name: 'instagram:post-reels:1',   account: 1, cron: '50 19 * * 2,4,6' },
  // { name: 'instagram:generate:2',     account: 2, cron: '0 20 * * 2,4,6' },
  // { name: 'instagram:image:2',        account: 2, cron: '10 20 * * 2,4,6' },
  // { name: 'instagram:render:2',       account: 2, cron: '25 20 * * 2,4,6' },
  // { name: 'instagram:post-image:2',   account: 2, cron: '45 20 * * 2,4,6' },
  // { name: 'instagram:post-reels:2',   account: 2, cron: '50 20 * * 2,4,6' },

  // ── YouTube — 停止中（2026-04-30 X/note集中戦略に切替） ──────────────
  // { name: 'youtube:reddit-fetch',              cron: '0 2 * * *' },
  // { name: 'youtube:reddit-generate',           cron: '0 3 * * *',        type: 'reddit-short' },
  // { name: 'youtube:render:reddit-short',       cron: '0 4 * * *',        type: 'reddit-short' },
  // { name: 'youtube:upload:reddit-short',       cron: '0 20 * * 1,2,3,4,5', type: 'reddit-short' },
  // { name: 'youtube:generate:breaking-short',   cron: '30 7 * * 1,3,5',  type: 'breaking-short' },
  // { name: 'youtube:render:breaking-short',     cron: '30 8 * * 1,3,5',  type: 'breaking-short' },
  // { name: 'youtube:upload:breaking-short',     cron: '0 12 * * 1,3,5',  type: 'breaking-short' },
  // { name: 'youtube:generate:short',            cron: '0 0 * * *',        type: 'short' },
  // { name: 'youtube:render:short',              cron: '0 1 * * *',        type: 'short' },
  // { name: 'youtube:upload:short',              cron: '0 18 * * 1,2,3,4,5', type: 'short' },
  // { name: 'youtube:generate:chatgpt-short',    cron: '0 5 * * *',        type: 'chatgpt-short' },
  // { name: 'youtube:render:chatgpt-short',      cron: '0 6 * * *',        type: 'chatgpt-short' },
  // { name: 'youtube:upload:chatgpt-short',      cron: '0 19 * * *',       type: 'chatgpt-short' },
  // { name: 'youtube:generate:anime-short',      cron: '0 4 * * *',        type: 'anime-short' },
  // { name: 'youtube:render:anime-short',        cron: '0 5 * * *',        type: 'anime-short' },
  // { name: 'youtube:upload:anime-short',        cron: '30 18 * * *',      type: 'anime-short' },
  // { name: 'youtube:generate:long',             cron: '0 0 * * 3',        type: 'long' },
  // { name: 'youtube:render:long',               cron: '0 2 * * 3',        type: 'long' },
  // { name: 'youtube:upload:long',               cron: '0 19 * * 3',       type: 'long' },
  // { name: 'youtube:plan',                      cron: '0 23 * * 0' },
  // { name: 'youtube:community-post',            cron: '0 9 * * 1,3,5' },
  // { name: 'youtube:post-community',            cron: '30 9 * * 1,3,5' }, // 登録者500人後

  // ── note account1: AI副業・自動化（毎日 = 7本/週） ─────────────
  { name: 'note:research', account: 1, cron: '30 5 * * 1,3,4,6' }, // 月水木土 05:30 — リサーチ（週4回でキューを厚く）
  { name: 'note:generate', account: 1, cron: '0 6 * * *' },        // 毎日 06:00 — 生成
  { name: 'note:post',     account: 1, cron: '0 20 * * *' },       // 毎日 20:00 — 投稿（Xエンゲージ最高峰）
  { name: 'x:note-promo',              cron: '15 20 * * *' },      // 毎日 20:15 — 投稿直後X告知（20時台がベスト時間帯）

  // ── note account2: 投資・FX・株（毎日 = 7本/週）───────────────── ①強化
  { name: 'note:research', account: 2, cron: '30 5 * * 1,2,4' },   // 月火木 05:30 — リサーチ（週3回）
  { name: 'note:generate', account: 2, cron: '0 8 * * *' },        // 毎日 08:00 — 生成（Ghost解放スロット）⑤
  { name: 'note:post',     account: 2, cron: '0 18 * * *' },       // 毎日 18:00 — 投稿（夕方ピーク）
  { name: 'x:note-promo',              cron: '15 18 * * *' },      // 毎日 18:15 — 投稿直後X告知

  // ── note account3: A8.netアフィリエイト（毎日 = 7本/週）────────── ①強化
  { name: 'note:research', account: 3, cron: '30 5 * * 0,2,5' },   // 日火金 05:30 — リサーチ（週3回）
  { name: 'note:generate', account: 3, cron: '0 13 * * *' },       // 毎日 13:00 — 生成（Ghost解放スロット）⑤
  { name: 'note:post',     account: 3, cron: '0 19 * * *' },       // 毎日 19:00 — 投稿（夕方ピーク）
  { name: 'x:note-promo',              cron: '15 19 * * *' },      // 毎日 19:15 — 投稿直後X告知

  // 合計: 7+7+7 = 21本/週 ≈ 3本/日（Ghost解放リソース転用）
  // ── note X再告知（7日・30日後 角度変えて再プロモ） ──────────────
  { name: 'note:repromo', cron: '0 20 * * 3' },                    // 水 20:00 — 7日/30日経過記事を再告知

  // ── Ghost 英語ブログ — 停止中（2026-04-27 トラクションなし・有料プラン前に一時停止）──
  // { name: 'ghost:research', cron: '0 6 * * *' },
  // { name: 'ghost:generate', cron: '0 8 * * *' },
  // { name: 'ghost:post',     cron: '0 13 * * *' },
  {
    name: 'research:ai-tools',
    cron: '0 6,18 * * *',          // 毎日 06:00・18:00 — 新MCP/Claude機能リサーチ（X は2日に1回）
  },
  {
    name: 'analytics:daily-research',
    cron: '0 7 * * *',             // 毎日 07:00 — GitHub/HN/Reddit AI トレンド収集 → x-writer トピック提案
  },
  {
    name: 'x:ai-news',
    cron: '0 9 * * *',             // 毎日 09:00 JST — AIニュースツイート + 引用RT
  },

  // ── X 自己リプライ返信（朝投稿・昼投稿へのフォローアップ） ──────
  { name: 'x:self-reply', slot: 'morning', cron: '30 8 * * *' },  // 毎日 08:30 JST — 朝投稿へのリプライ返信
  { name: 'x:self-reply', slot: 'noon',    cron: '0 13 * * *'  }, // 毎日 13:00 JST — 昼投稿へのリプライ返信
  { name: 'x:post-self-reply', cron: '*/30 * * * *' },            // 30分毎 — 2h遅延 self-reply キュー処理

  // ── Anthropic クレジット残高監視（毎朝 + 夜） ────────────────────
  {
    name: 'anthropic:check-credits',
    cron: '0 8,20 * * *',          // 毎日 08:00・20:00 — 残高チェック ($5警告/$1危機)
  },

  // ── ダッシュボード Neon 同期（毎時） ────────────────────────────
  {
    name: 'dashboard:push-to-neon',
    cron: '0 * * * *',             // 毎時 00分 — ダッシュボードデータを Neon DB へ push
  },
];
