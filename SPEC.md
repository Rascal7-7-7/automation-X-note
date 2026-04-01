# 自動化システム 仕様書

## 概要

X（Twitter）と note.com の半自動コンテンツ配信システム。
リサーチ・記事生成・画像生成・投稿までを自動化し、note の最終公開のみ手動で行う。

---

## アーキテクチャ

```
scheduler/index.js  ← cron で全タスクを統括
    │
    ├── x/
    │   ├── research.js      Playwright で X を検索・スコアリング → キュー積み
    │   ├── pipeline.js      キュー処理・生成・検証・レビュー・投稿
    │   ├── like.js          スコア閾値を超えたツイートにいいね
    │   ├── note-promo.js    note 記事の X 告知投稿
    │   ├── post.js          X API v2 経由の投稿（API 設定時）
    │   ├── post-browser.js  ブラウザ経由の投稿（API 未設定時フォールバック）
    │   └── browser-client.js  Playwright ブラウザ共通クライアント
    │
    ├── note/
    │   ├── research.js      トレンドリサーチ → テーマ案をキューへ
    │   ├── generate.js      Claude Sonnet で記事生成 → drafts/ に保存
    │   ├── image.js         DALL-E 等でヘッダー画像を生成
    │   ├── post.js          Playwright で note.com に下書き保存 → notify.py 呼び出し
    │   └── notify.py        【Python】下書き URL をブラウザで開く（公開補助）
    │
    ├── analytics/
    │   ├── logger.js        X 投稿・note 投稿のログ記録
    │   ├── collect-x.js     X エンゲージメント指標の収集
    │   └── buzz-analyzer.js バズ分析 → prompt-hints.json 生成
    │
    └── shared/
        ├── claude-client.js  Anthropic SDK ラッパー
        ├── queue.js          ファイルベース永続キュー（ロック付き）
        ├── daily-limit.js    1日の投稿数制限（ファイル永続化）
        └── logger.js         共通ロガー
```

---

## タスク一覧とスケジュール

| タスク名 | cron | 内容 |
|---------|------|------|
| `x:enqueue` | 毎日 07:00 | X リサーチ → 投稿キュー積み |
| `x:process` | 毎日 08:30 / 12:30 / 18:30 | キューから生成・検証・投稿（1日最大5件） |
| `x:like` | 毎日 12:00 / 18:00 | スコア上位ツイートにいいね（最大5件/回） |
| `note:research` | 月曜 08:00 | トレンド分析 → テーマ案生成 |
| `note:generate` | 月曜 10:00 | Claude Sonnet で記事生成 |
| `note:image` | 月曜 11:00 | ヘッダー画像生成 |
| `note:post` | 火曜 10:00 | Playwright で note.com に下書き保存 |
| `x:note-promo` | 火曜 10:15 | note 公開後に X で告知 |
| `x:collect` | 毎日 22:00 | X エンゲージメント収集 |
| `analytics:buzz` | 毎日 23:00 | バズ分析 → 次回生成ヒント更新 |

---

## X 投稿フロー（完全自動）

```
x:enqueue
  └─ research.js
       Playwright で x.com を検索（AI / 個人開発 / 金融 の3ドメイン）
       スコア上位をドメイン均等に x/queue/main.jsonl へ積む
         ↓
x:process
  └─ pipeline.js
       1. main.jsonl からアイテムを1件取得
       2. Claude Haiku でツイート生成
       3. ルールベース検証（140字・禁止語）
       4. AI レビュー（prod のみ）
       5. X API v2 / ブラウザ経由で投稿
       6. 日別制限チェック（最大5件/日）
       7. analytics/logger.js に記録
```

### キュー構造

| ファイル | 役割 |
|---------|------|
| `x/queue/main.jsonl` | 通常キュー |
| `x/queue/retry.jsonl` | リトライ待ち（失敗時） |
| `x/queue/failed.jsonl` | 最大リトライ超過（手動確認） |
| `x/queue/liked.json` | いいね済みツイート ID 記録 |

---

## note 投稿フロー（半自動）

```
note:research（月曜 08:00）
  └─ トレンドリサーチ → note/queue/ideas.jsonl へテーマを積む
       ↓
note:generate（月曜 10:00）
  └─ ideas.jsonl からテーマを取得
     analytics/reports/prompt-hints.json を参照（過去バズデータ）
     Claude Sonnet で構成 → 本文の2段階生成
     note/drafts/{timestamp}-{title}.json に保存
       ↓
note:image（月曜 11:00）
  └─ draft の imagePrompt から DALL-E / 画像生成 API でヘッダー画像生成
     note/drafts/images/{timestamp}.png に保存
       ↓
note:post（火曜 10:00）
  └─ drafts/ の最古ドラフトを Playwright で note.com に下書き保存
     draft に noteUrl, status="posted", promoPosted=false を付与
     notify.py --open を呼び出し → ブラウザが下書きページを開く
       ↓
【手動】ブラウザで「公開」ボタンを押す  ← ここだけ手動
       ↓
x:note-promo（火曜 10:15）
  └─ status="posted" && promoPosted=false のドラフトを検索
     Claude Haiku で告知ツイートを生成
     検証・レビュー後に X 投稿
     promoPosted=true に更新
```

### note ドラフト JSON スキーマ

```json
{
  "title":        "記事タイトル",
  "summary":      "概要（X 告知に使用）",
  "body":         "本文（Markdown）",
  "theme":        "テーマ",
  "angle":        "切り口",
  "createdAt":    "ISO8601",
  "status":       "draft | posted",
  "imagePath":    "/path/to/image.png",
  "imagePrompt":  "画像生成に使ったプロンプト",
  "noteUrl":      "https://note.com/...",
  "postedAt":     "ISO8601",
  "promoPosted":  false,
  "promoPostedAt":"ISO8601"
}
```

---

## セーフガード

| 機能 | 実装場所 | 内容 |
|-----|---------|------|
| 日別投稿制限 | `shared/daily-limit.js` | X 投稿は最大 5件/日（ファイル永続化） |
| ルールベース検証 | `x/pipeline.js:validateTweet` | 140文字超過・禁止語チェック |
| AI レビュー | `x/pipeline.js:reviewTweet` | prod モードのみ Claude で品質チェック |
| 同時実行防止 | `scheduler/index.js` | 各タスクに `isRunning` フラグ |
| キューロック | `shared/queue.js` | スピンロックで競合防止 |
| 重複いいね防止 | `x/like.js` | `x/queue/liked.json` で処理済み ID 管理 |
| X 告知二重投稿防止 | `x/note-promo.js` | `promoPosted` フラグ確認 |
| note 下書き誤投稿防止 | `note/post.js` | 下書き保存のみ、公開は必ず手動 |

---

## 環境変数

| 変数名 | 必須 | 用途 |
|-------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API（記事・ツイート生成） |
| `X_API_KEY` | 任意 | X API v2（未設定時はブラウザ投稿） |
| `X_API_SECRET` | 任意 | X API v2 |
| `X_ACCESS_TOKEN` | 任意 | X API v2 |
| `X_ACCESS_TOKEN_SECRET` | 任意 | X API v2 |
| `NOTE_EMAIL` | ✅ | note.com ログイン用メール |
| `NOTE_PASSWORD` | ✅ | note.com ログイン用パスワード |
| `OPENAI_API_KEY` | 任意 | 画像生成（DALL-E 使用時） |

---

## ログ・レポートファイル

| パス | 内容 |
|-----|------|
| `logs/daily-limit.json` | 当日の X 投稿数 |
| `logs/analytics/x-posts.jsonl` | X 投稿履歴 |
| `logs/analytics/note-posts.jsonl` | note 投稿履歴 |
| `analytics/reports/x-summary.json` | X バズ分析結果 |
| `analytics/reports/note-summary.json` | note 分析結果 |
| `analytics/reports/prompt-hints.json` | 次回生成に使うヒント |

---

## 動作モード

| `MODE` | 動作 |
|--------|------|
| `dev`（デフォルト） | ツイート生成結果をコンソール表示して終了（投稿しない） |
| `prod` | AI レビュー通過後に実際に投稿 |
