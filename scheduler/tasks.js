export const TASKS = [
  // ── X（毎日）────────────────────────────────────────────────────
  {
    name: 'x:enqueue',
    cron: '0 7 * * *',             // 毎日 07:00 — リサーチ → キュー積み
    // null を渡すと research.js が全ドメイン（ai/dev/finance）を網羅
    keywords: null,
  },
  {
    name: 'x:process',
    cron: '30 8,12,18 * * *',      // 毎日 3回 — 生成 → validate → review → post
  },
  {
    name: 'x:like',
    cron: '0 12,18 * * *',         // 毎日 2回 — いいね（最大5件/回）
    // 3ドメインからまんべんなくいいねする
    keywords: ['AI活用', 'Claude', '個人開発', '副業エンジニア', 'NISA', '投資'],
  },

  // ── note（週1回：月曜に生成、火曜に投稿） ────────────────────────
  {
    name: 'note:research',
    cron: '0 8 * * 1',             // 月曜 08:00 — スクレイプ → テーマ生成
  },
  {
    name: 'note:generate',
    cron: '0 10 * * 1',            // 月曜 10:00 — 記事生成（research後にバッファ確保）
  },
  {
    name: 'note:image',
    cron: '0 11 * * 1',            // 月曜 11:00 — 画像生成
  },
  {
    name: 'note:post',
    cron: '0 10 * * 2',            // 火曜 10:00 — DEV: 下書き保存 / PROD: 自動公開
  },

  // ── X エンゲージメント拡大（毎日）────────────────────────────────
  {
    name:     'x:reply',
    cron:     '0 9,21 * * *',       // 毎日 2回 — 高エンゲージツイートへのリプライ（最大10件/日）
    keywords: ['AI活用', 'Claude', '副業', '自動化', '生産性', 'ChatGPT'],
  },
  {
    name:     'x:quote-rt',
    cron:     '30 9 * * *',         // 毎日 09:30 — バズツイート引用RT（最大3件/日）
    keywords: ['AI活用', 'Claude', '生成AI', '個人開発'],
  },

  // ── 流入導線（火曜投稿の15分後にX告知） ─────────────────────────
  {
    name: 'x:note-promo',
    cron: '15 10 * * 2',           // 火曜 10:15 — note公開後にX告知
  },

  // ── Instagram account=1（AI副業系・毎日） ──────────────────────
  {
    name:    'instagram:generate:1',
    cron:    '0 9 * * *',            // 毎日 09:00 — キャプション・画像プロンプト生成
    account: 1,
  },
  {
    name:    'instagram:image:1',
    cron:    '30 9 * * *',           // 毎日 09:30 — DALL-E 3 生成 → Imgur アップロード → imageUrl 設定
    account: 1,
  },
  {
    name:    'instagram:post:1',
    cron:    '0 19 * * *',           // 毎日 19:00 — 投稿（エンゲージ最大帯）
    account: 1,
  },

  // ── Instagram account=2（アフィリエイト専門・週3回） ────────────
  // 月・水・金の投稿でローテーション（同じ案件の連続投稿を防ぐ）
  {
    name:    'instagram:generate:2',
    cron:    '0 10 * * 1,3,5',       // 月・水・金 10:00 — 案件選択 + キャプション生成
    account: 2,
  },
  {
    name:    'instagram:image:2',
    cron:    '30 10 * * 1,3,5',      // 月・水・金 10:30 — DALL-E 3 生成 → Imgur アップロード → imageUrl 設定
    account: 2,
  },
  {
    name:    'instagram:post:2',
    cron:    '0 19 * * 1,3,5',       // 月・水・金 19:00 — 投稿
    account: 2,
  },

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

  // ── 分析（毎日深夜） ───────────────────────────────────────────
  {
    name: 'x:collect',
    cron: '0 22 * * *',            // 毎日 22:00 — Xエンゲージメント収集
  },
  {
    name: 'analytics:buzz',
    cron: '0 23 * * *',            // 毎日 23:00 — バズ分析 → レポート生成
  },

  // ── Instagram トークン期限監視（毎日朝） ────────────────────────
  {
    name: 'instagram:check-expiry',
    cron: '0 9 * * *',             // 毎日 09:00 — トークン残日数チェック
  },
];
