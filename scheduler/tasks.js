// Routinesで管理するタスク（リモート実行・Mac不要）:
//   X投稿/いいね/リプライ/引用RT、note生成/投稿、Instagram生成/投稿、X Analytics
// ローカルschedulerはMac必須タスク（YouTube動画生成・アップロード）のみを担当

export const TASKS = [
  // ── X スレッド記事（Routineなし・火・木 週2回） ──────────────────
  {
    name: 'x:article',
    cron: '0 7 * * 2,4',           // 火・木 07:00 — スレッド記事投稿
  },

  // ── Instagram トークン期限監視（毎日朝） ──────────────────────────
  {
    name: 'instagram:check-expiry',
    cron: '0 9 * * *',             // 毎日 09:00 — トークン残日数チェック
  },

  // ── Instagram account1 パイプライン（火・木・土 19時台） ──────────
  { name: 'instagram:generate:1', account: 1, cron: '0 19 * * 2,4,6' },   // 19:00 生成
  { name: 'instagram:image:1',    account: 1, cron: '10 19 * * 2,4,6' },  // 19:10 画像生成
  { name: 'instagram:render:1',   account: 1, cron: '25 19 * * 2,4,6' },  // 19:25 Reels生成
  { name: 'instagram:post:1',     account: 1, cron: '45 19 * * 2,4,6' },  // 19:45 投稿

  // ── Instagram account2 パイプライン（火・木・土 20時台） ──────────
  { name: 'instagram:generate:2', account: 2, cron: '0 20 * * 2,4,6' },   // 20:00 生成
  { name: 'instagram:image:2',    account: 2, cron: '10 20 * * 2,4,6' },  // 20:10 画像生成
  { name: 'instagram:render:2',   account: 2, cron: '25 20 * * 2,4,6' },  // 20:25 Reels生成
  { name: 'instagram:post:2',     account: 2, cron: '45 20 * * 2,4,6' },  // 20:45 投稿

  // ── YouTube Reddit読み上げ（毎日） ───────────────────────────────────
  {
    name: 'youtube:reddit-fetch',
    cron: '0 2 * * *',              // 毎日 02:00 — AIサブレディットのトップ投稿取得
  },
  {
    name: 'youtube:reddit-generate',
    cron: '0 3 * * *',              // 毎日 03:00 — 日本語台本に翻訳・生成
    type: 'reddit-short',
  },
  {
    name: 'youtube:render:reddit-short',
    cron: '0 4 * * *',              // 毎日 04:00 — Ken Burns + Whisper で動画生成
    type: 'reddit-short',
  },
  {
    name: 'youtube:upload:reddit-short',
    cron: '0 20 * * 1,2,3,4,5',    // 平日 20:00 — アップロード（AI動画の2時間後）
    type: 'reddit-short',
  },

  // ── YouTube ショート（毎日） ────────────────────────────────────
  {
    name: 'youtube:generate:short',
    cron: '0 0 * * *',            // 毎日 00:00 — 台本・タイトル生成
    type: 'short',
  },
  {
    name: 'youtube:render:short',
    cron: '0 1 * * *',            // 毎日 01:00 — 動画レンダリング
    type: 'short',
  },
  {
    name: 'youtube:upload:short',
    cron: '0 18 * * 1,2,3,4,5',  // 平日 18:00 — アップロード（週末は除く）
    type: 'short',
  },

  // ── YouTube ロング（水曜週1回） ──────────────────────────────────
  {
    name: 'youtube:generate:long',
    cron: '0 0 * * 3',            // 水曜 00:00 — 台本生成
    type: 'long',
  },
  {
    name: 'youtube:render:long',
    cron: '0 2 * * 3',            // 水曜 02:00 — レンダリング（長いので2時間後）
    type: 'long',
  },
  {
    name: 'youtube:upload:long',
    cron: '0 19 * * 3',           // 水曜 19:00 — アップロード
    type: 'long',
  },

  // ── YouTube テーマ週次自動生成（毎週日曜 23:00） ────────────────
  {
    name: 'youtube:plan',
    cron: '0 23 * * 0',            // 毎週日曜 23:00 — 翌週分テーマを weekly_plan.json に追記
  },

  // ── Ghost 英語ブログ（毎日） ──────────────────────────────────────
  {
    name: 'ghost:research',
    cron: '0 6 * * *',             // 毎日 06:00 — Reddit/HNトレンド取得
  },
  {
    name: 'ghost:generate',
    cron: '0 8 * * *',             // 毎日 08:00 — 英語記事生成
  },
  {
    name: 'ghost:post',
    cron: '0 13 * * *',            // 毎日 13:00 — Ghost公開
  },
  {
    name: 'research:ai-tools',
    cron: '0 6,18 * * *',          // 毎日 06:00・18:00 — 新MCP/Claude機能リサーチ（X は2日に1回）
  },
];
