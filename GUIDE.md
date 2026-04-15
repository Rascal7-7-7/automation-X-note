# SNS副業 完全自動化システム 構築ガイド

> 対象: プログラミング初心者〜中級者  
> 所要時間: 2〜4時間（アカウント準備除く）  
> 目的: X（Twitter）・note・Instagram・YouTube の投稿を AI で自動化し、副業収益を最大化する

---

## はじめに：このシステムで何ができるのか

**1人でチーム規模のSNS運用**を実現するシステムです。

| 操作 | 手動の場合 | このシステム |
|------|-----------|------------|
| X のネタ探し | 毎日30分 | 毎朝7時に自動実行 |
| ツイート作成・投稿 | 1日3回 × 5分 | 自動（8:30 / 12:30 / 18:30）|
| 人気ツイートへいいね | 毎日手動 | 自動（12:00 / 18:00）|
| note 記事執筆（3000字） | 3〜5時間 | AI が下書き生成 |
| Instagram キャプション | 30分 | AI が即時生成 |
| YouTube ショート台本 | 1〜2時間 | AI が即時生成（毎日9:00）|
| YouTube 長尺台本・構成 | 3〜5時間 | AI が構成・チャプター生成（木曜）|
| YouTube メタデータ最適化 | 30分 | タイトル5案・タグ・説明文を自動生成 |
| エンゲージメント分析 | 毎日集計 | 毎夜22時に自動レポート |

---

## システム全体像

```
┌────────────────────────────────────────────────┐
│  あなた（CEO）                                    │
│  ↓ Telegram でチャット指示                        │
├────────────────────────────────────────────────┤
│  OpenClaw（AIエージェントゲートウェイ）           │
│  ポート: 8080                                    │
│  → 自然言語指示を受け取りBridge Serverを操作      │
├──────────────────┬─────────────────────────────┤
│  n8n             │  Bridge Server               │
│  ポート: 5678    │  ポート: 3001                 │
│  スケジュール    │  各モジュールのAPIラッパー     │
│  自動実行エンジン│                               │
├──────────────────┴─────────────────────────────┤
│  自動化モジュール群（Node.js スクリプト）          │
│  x/research.js      ← Xトレンド収集（Playwright）│
│  x/post.js          ← ツイート生成・投稿（xurl） │
│  x/like.js          ← いいね実行（xurl）         │
│  note/*.js          ← note記事生成・投稿         │
│  instagram/*.js     ← Instagramコンテンツ生成    │
│  youtube/generate.js← YouTube台本・メタデータ生成│
│  youtube/upload.js  ← YouTube Data API v3 投稿  │
│  youtube/research.js← YouTubeトレンド収集        │
│  youtube/collect.js ← YouTube Analytics収集      │
├────────────────────────────────────────────────┤
│  Claude API（Anthropic）                         │
│  Haiku: 軽量タスク（ツイート生成など）            │
│  Sonnet: 高品質タスク（note記事・レビュー）       │
└────────────────────────────────────────────────┘
```

---

## 使用ツール一覧と役割

| ツール | 役割 | 費用 |
|--------|------|------|
| **Node.js** | 自動化スクリプトの実行環境 | 無料 |
| **n8n** | スケジュール自動実行エンジン | 無料（セルフホスト）|
| **Bridge Server** | n8n → スクリプトをつなぐAPI | 無料（自作）|
| **OpenClaw** | Telegram から AI に指示するゲートウェイ | 無料（セルフホスト）|
| **xurl** | X（Twitter）API CLIツール | 無料（X API無料枠）|
| **Playwright** | ブラウザ自動化（X検索に使用）| 無料 |
| **Claude API** | AIによるコンテンツ生成 | 従量課金 |
| **X API** | ツイート投稿・いいね | 無料〜有料 |
| **Telegram Bot** | スマホからの操作インターフェース | 無料 |

---

## 事前準備チェックリスト

### 必須

- [ ] Node.js 18以上がインストール済み（`node --version` で確認）
- [ ] Anthropic APIキーを取得（[console.anthropic.com](https://console.anthropic.com)）
- [ ] X（Twitter）デベロッパーアカウントを取得
- [ ] X APIのキー一式（APIキー・シークレット・アクセストークン・ベアラートークン）
- [ ] Telegram でBotを作成（@BotFather に `/newbot`）

### 任意（後から設定可）

- [ ] Instagram Creator アカウント + Meta Graph API設定（SMS認証待ち）
- [x] YouTube チャンネル + Google Cloud Console OAuth2設定（完了）
- [x] Nanobanana Pro（画像生成）GEMINI_API_KEY（完了）
- [ ] Renoise（AI動画生成）APIキー
- [ ] HeyGen APIキー（アバター動画生成）← `HEYGEN_API_KEY` を `.env` に追加

---

## ステップ1：ファイル構成とセットアップ

### 1-1. フォルダ構成

```
automation/
├── bridge/             ← Bridge Server（APIラッパー）
│   ├── server.js
│   └── routes/
│       ├── x.js
│       ├── note.js
│       ├── instagram.js
│       └── analytics.js
├── x/                  ← X自動化モジュール
│   ├── research.js     ← トレンド収集（Playwright）
│   ├── post.js         ← ツイート投稿（xurl）
│   └── like.js         ← いいね（xurl）
├── note/               ← note自動化モジュール
├── instagram/          ← Instagram自動化モジュール
│   ├── generate.js     ← キャプション・台本生成
│   ├── post.js         ← Graph API投稿
│   └── collect.js      ← インサイト収集
├── shared/             ← 共通ユーティリティ
│   ├── claude-client.js
│   ├── queue.js
│   └── logger.js
├── n8n/
│   ├── data/           ← n8nのデータ保存場所
│   └── workflows/      ← ワークフローJSON（8本）
├── openclaw/
│   └── SOUL.md         ← OpenClawエージェントの人格定義
├── .claude/
│   ├── CLAUDE.md       ← COO（司令塔）の定義書
│   └── agents/         ← 専門エージェント10体
├── .env                ← APIキーなどの環境変数
├── package.json
└── start.sh            ← 一括起動スクリプト
```

### 1-2. 依存パッケージのインストール

```bash
cd /path/to/automation
npm install
```

主な依存パッケージ:
- `express` — Bridge Server
- `playwright` — ブラウザ自動化（X検索）
- `@anthropic-ai/sdk` — Claude API
- `concurrently` — 複数サービスの同時起動

### 1-3. 環境変数の設定

`.env` ファイルを作成して以下を設定します。

```env
# Anthropic（Claude API）
ANTHROPIC_API_KEY=sk-ant-xxxxx

# X（Twitter）API
X_API_KEY=xxxxx
X_API_SECRET=xxxxx
X_ACCESS_TOKEN=xxxxx
X_ACCESS_TOKEN_SECRET=xxxxx

# Claude API
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Gemini（Nanobanana Pro 画像生成用）
GEMINI_API_KEY=xxxxx

# Instagram（Creator アカウント設定後）
INSTAGRAM_ACCESS_TOKEN=xxxxx
INSTAGRAM_BUSINESS_ACCOUNT_ID=xxxxx

# YouTube（Google Cloud Console設定後）
YOUTUBE_CLIENT_ID=xxxxx.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=xxxxx
YOUTUBE_REFRESH_TOKEN=xxxxx
YOUTUBE_CHANNEL_ID=UCxxxxx

# HeyGen（アバター動画生成 — YouTube Shorts / Instagram Reels）
# 取得先: https://app.heygen.com/settings?nav=API
# HEYGEN_API_KEY が設定されている場合は HeyGen でアバター動画を生成し、
# 未設定の場合は FFmpeg + Nanobanana Pro にフォールバックします。
HEYGEN_API_KEY=
# 使用するアバター ID（省略時: アカウント内の最初のアバターを自動選択）
HEYGEN_AVATAR_ID=
# 日本語ボイス ID（省略時: 日本語女性ボイスを自動選択）
HEYGEN_VOICE_ID_JA=
```

> セキュリティ注意: `.env` は絶対にGitにコミットしないこと。`.gitignore` に追加済みか確認してください。

---

## ステップ2：xurl のセットアップ（X API連携）

xurl は X（Twitter）の公式API CLIツールです。
`post`・`like` などの操作を1行のコマンドで実行できます。

### 2-1. インストール確認

OpenClaw に同梱されているため、OpenClaw インストール後は追加インストール不要です。

```bash
xurl whoami
# → 自分のX アカウント情報が表示されればOK
```

### 2-2. 認証設定

#### OAuth1（投稿・いいねに使用）

```bash
xurl auth oauth1 \
  --consumer-key     "X_API_KEY の値" \
  --consumer-secret  "X_API_SECRET の値" \
  --access-token     "X_ACCESS_TOKEN の値" \
  --token-secret     "X_ACCESS_TOKEN_SECRET の値"
```

#### Bearer Token（アプリ認証）

```bash
xurl auth app --bearer-token "X_BEARER_TOKEN の値"
```

### 2-3. 動作確認

```bash
# アカウント情報確認
xurl whoami

# テスト投稿（※実際に投稿されます）
xurl post "テスト投稿です"

# いいね
xurl like 1234567890123456789
```

### 2-4. xurl でできること・できないこと

| コマンド | 使用可否 | 理由 |
|---------|---------|------|
| `xurl post "文章"` | ✅ 使用可 | OAuth1投稿（無料枠）|
| `xurl like <ID>` | ✅ 使用可 | OAuth1いいね（無料枠）|
| `xurl whoami` | ✅ 使用可 | 無料 |
| `xurl search キーワード` | ⚠️ 要クレジット | X API Basic以上が必要 |
| `xurl timeline` | ⚠️ 要クレジット | 同上 |

> 検索は Playwright（ブラウザ自動化）で代替しています。APIコストを最小化するための設計です。

---

## ステップ3：Bridge Server の起動

Bridge Server は n8n や OpenClaw から既存の Node.js スクリプトを
HTTP APIとして呼び出すための「橋渡し役」です。

### 3-1. 単体起動

```bash
npm run bridge
# → http://localhost:3001 で起動
```

### 3-2. 動作確認

```bash
curl http://localhost:3001/health
# → {"ok":true,"ts":"2026-04-09T..."}
```

### 3-3. APIエンドポイント一覧

| エンドポイント | 処理内容 |
|--------------|---------|
| `POST /api/x/research` | Xトレンド収集 → キュー追加 |
| `POST /api/x/process` | ツイート生成 → 投稿 |
| `POST /api/x/like` | いいね自動実行 |
| `POST /api/x/note-promo` | note告知ツイート |
| `POST /api/note/research` | noteトレンド収集 |
| `POST /api/note/generate` | note記事生成 |
| `POST /api/note/post` | note下書き保存 |
| `POST /api/instagram/generate` | キャプション・台本・画像プロンプト生成 |
| `POST /api/instagram/post` | Instagram投稿 |
| `POST /api/instagram/collect` | インサイト収集 |
| `POST /api/analytics/collect-x` | Xエンゲージメント収集 |
| `POST /api/analytics/buzz` | バズ分析レポート |
| `POST /api/youtube/research` | YouTubeトレンド収集（Playwright）|
| `POST /api/youtube/generate` | YouTube台本・タイトル・説明文生成 |
| `POST /api/youtube/render` | Nanobanana Pro+FFmpegで動画自動生成（顔・声なし）|
| `POST /api/youtube/upload` | YouTube Data API v3 動画アップロード |
| `POST /api/youtube/collect` | YouTube Analytics 収集 |

---

## ステップ4：n8n のセットアップ（スケジュール自動実行）

n8n はワークフロー自動化ツールです。「毎朝7時に○○を実行」のような
スケジュールを視覚的に設定できます。

### 4-1. 起動

```bash
npm run n8n
# → http://localhost:5678 で起動
```

初回起動時はメールアドレスとパスワードの登録画面が表示されます。

### 4-2. ワークフローのインポート手順

1. http://localhost:5678 をブラウザで開く
2. 左メニュー「Workflows」をクリック
3. 右上の「Add Workflow」→「Import from File」
4. `n8n/workflows/` フォルダの JSON を1ファイルずつ選択してインポート
5. インポート後、各ワークフローを開いて「Active」スイッチをONにする

### 4-3. インポートするワークフロー（8本）

| ファイル名 | 実行タイミング | 内容 |
|-----------|-------------|------|
| `x-research.json` | 毎日 07:00 | Xのトレンドを収集してキューに保存 |
| `x-process.json` | 毎日 08:30 / 12:30 / 18:30 | ツイートを生成して投稿 |
| `x-like.json` | 毎日 12:00 / 18:00 | 人気ツイートにいいね |
| `note-research.json` | 月曜 08:00 | noteのトレンドを収集 |
| `note-generate.json` | 月曜 10:00〜11:00 | note記事を生成 |
| `note-post.json` | 火曜 10:00 | note下書き保存 → X告知 |
| `instagram-daily.json` | 毎日 08:00 / 12:00 / 22:00 | Instagram コンテンツ生成・投稿 |
| `analytics-daily.json` | 毎日 22:00 / 23:00 | エンゲージメント収集・分析 |
| `youtube-short-daily.json` | 月曜 06:00 リサーチ / 毎日 09:00 生成+レンダリング / 平日 18:00 投稿 | YouTube ショート自動化 |
| `youtube-long-weekly.json` | 木曜 10:00 生成+レンダリング / 水曜 19:00 投稿 | YouTube 長尺自動化 |
| `youtube-analytics.json` | 毎日 23:30 | YouTube Analytics 収集 |

---

## ステップ5：OpenClaw のセットアップ（Telegram操作）

OpenClaw は AI エージェントゲートウェイです。
Telegram のチャットから「ツイートして」と送るだけで自動投稿できます。

### 5-1. インストール

```bash
npm install -g openclaw@latest
```

### 5-2. 初期設定

```bash
openclaw doctor
```

設定ウィザードに従ってセットアップします。

### 5-3. Telegram Bot の作成

1. Telegram で **@BotFather** を検索して開く
2. `/newbot` と送信
3. Bot名とユーザー名を設定（例: `MySNSBot` / `myai_sns_bot`）
4. 表示された **Bot Token** をコピー（`8282941950:AAEeUIvm...` のような形式）

### 5-4. Telegram の設定を openclaw.json に反映

`~/.openclaw/openclaw.json` を編集します。

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "ここにBotTokenを貼り付ける",
      "dmPolicy": "open",
      "allowFrom": ["*"]
    }
  }
}
```

### 5-5. Claude CLI 認証

OpenClaw が Claude を使用するための認証を設定します。

```bash
openclaw models auth login
# → ブラウザが開くので Claude アカウントでログイン
```

> この操作はインタラクティブな入力が必要なため、**必ずターミナルで実行**してください（Claude Code 内では実行できません）。

### 5-6. OpenClaw の起動

```bash
openclaw start
# → ポート 8080 で起動
```

### 5-7. SOUL.md（エージェント人格）の適用

OpenClaw のエージェントに SNS 自動化の知識を持たせます。

```bash
cp /path/to/automation/openclaw/SOUL.md ~/.openclaw/workspace/CLAUDE.md
```

### 5-8. Telegram での動作確認

1. Telegram で作成した Bot を検索して開く
2. `/start` を送信
3. 「ヘルスチェックして」と送信
4. Bridge Server の状態が返ってくれば成功

---

## ステップ6：全サービスの一括起動

### 6-1. 起動スクリプトの実行

```bash
cd /path/to/automation
chmod +x start.sh
./start.sh
```

これで Bridge Server（3001）と n8n（5678）が同時に起動します。
OpenClaw は別ターミナルで起動してください。

```bash
# 別ターミナルで
openclaw start
```

### 6-2. 起動確認

| サービス | 確認方法 |
|---------|---------|
| Bridge Server | `curl http://localhost:3001/health` |
| n8n | ブラウザで http://localhost:5678 を開く |
| OpenClaw | Telegram で Bot にメッセージを送る |

---

## システムのしくみ：詳細説明

### X 自動投稿のしくみ

```
07:00 n8n
  → POST /api/x/research
  → Playwright でブラウザを起動
  → X を検索してトレンド取得
  → x/queue/ideas.jsonl に保存

08:30 n8n
  → POST /api/x/process
  → ideas.jsonl からアイデアを1件取り出す
  → Claude Haiku で140文字以内のツイートを生成
  → xurl post "ツイート文" で投稿
  → x/queue/posted.jsonl に記録
```

### X いいねのしくみ

```
12:00 n8n
  → POST /api/x/like
  → xurl search でキーワード検索（クレジット消費時はスキップ）
  → 各ツイートのスコアを計算
      スコア = いいね数 + リツイート数 × 2
  → 閾値（デフォルト5点）を超えたツイートにいいね
  → x/queue/liked.json に記録（重複防止）
```

### Instagram コンテンツ生成のしくみ

バズる動画・投稿を7つの「型」で自動生成します。

| 型 | 名前 | フック例 |
|----|------|---------|
| A | 有益情報型 | 知らないと損する |
| B | 衝撃事実型 | 実はこうだった件 |
| C | ビフォーアフター型 | 変わる前と後 |
| D | 共感・あるある型 | こんな経験ない？ |
| E | ストーリー型 | 個人体験から学ぶ |
| F | ランキング型 | 厳選おすすめ |
| G | How-to型 | ステップで解説 |

```
08:00 n8n
  → POST /api/instagram/generate
  → weekly_plan.json から今日のテーマとバズ型を取得
    （なければ曜日でローテーション）
  → Claude Sonnet で並列生成:
      ① キャプション（型 × テーマ）
      ② Reels台本（15〜30秒、Renoise AI動画生成用）
      ③ 画像生成プロンプト（Nanobanana Pro用）
  → instagram/drafts/{日付}/post.json に保存
```

### Claude エージェント（10体）のしくみ

`.claude/agents/` フォルダに 10 体の専門エージェントがいます。
Claude Code から「今日のX投稿対応して」と指示すると、COO エージェントが
各専門エージェントを指揮して自動実行します。

```
CEO（あなた）
  ↓「今日のX投稿対応して」
COO（CLAUDE.md）
  ├── trend-researcher → トレンド収集
  ├── x-writer → ツイート生成
  ├── content-reviewer → 品質チェック
  └── publisher → 投稿実行
```

| エージェント | 役割 | モデル |
|------------|------|-------|
| trend-researcher | トレンド収集・キーワード分析 | Haiku |
| market-researcher | ASP案件・競合調査 | Haiku |
| x-writer | Xツイート生成（アカウント別トーン）| Haiku |
| note-writer | note記事生成（3000〜5000字）| Sonnet |
| insta-writer | Instagramキャプション・Reels台本 | Haiku |
| content-reviewer | 品質・法令・トーンチェック | Sonnet |
| publisher | Bridge Server / xurl 経由の実投稿 | Haiku |
| scheduler | n8nワークフロー状態管理 | Haiku |
| data-collector | エンゲージメントデータ収集 | Haiku |
| growth-analyst | バズ分析・戦略提案・週次レポート | Sonnet |

---

## よくある使い方

### Telegram から操作する（OpenClaw経由）

```
あなた → Bot: 「ツイートして」
Bot → Bridge Server: POST /api/x/process
Bot → あなた: ✅ 完了しました

あなた → Bot: 「今日のX投稿フル対応して」
Bot → 自動で: research → process（3回）

あなた → Bot: 「note週次フロー」
Bot → 自動で: research → generate → image → post → x:note-promo
```

### xurl で手動操作する

```bash
# 今すぐツイート
xurl post "内容"

# 指定ツイートにいいね
xurl like 1234567890

# 自分の情報確認
xurl whoami
```

### Bridge Server に直接リクエストする

```bash
# X トレンドリサーチ
curl -X POST http://localhost:3001/api/x/research

# Instagram コンテンツ生成
curl -X POST http://localhost:3001/api/instagram/generate

# バズ分析レポート
curl -X POST http://localhost:3001/api/analytics/buzz
```

---

## Instagram 事前計画：weekly_plan.json

投稿テーマを事前に週単位で設定できます。

`instagram/queue/weekly_plan.json`:
```json
{
  "2026-04-14": { "theme": "AIツール活用術", "buzzTypeId": "G" },
  "2026-04-15": { "theme": "副業で稼ぐAI活用法", "buzzTypeId": "F" },
  "2026-04-16": { "theme": "ChatGPT時短テクニック", "buzzTypeId": "A" }
}
```

設定がない日は曜日に応じて自動選択されます。

---

## ステップ7：Claude Code スキルのインストール

スキルは Claude Code・OpenClaw などの AI エージェントに追加機能を付与する拡張パックです。
[skills.sh](https://skills.sh) で公開されており、1コマンドでインストールできます。

### 7-1. スキルのインストールコマンド

```bash
npx skills add <owner/repo>
```

インタラクティブな選択画面が表示されます。

- **スキル選択**: スペースキーでトグル、Enter で確定
- **エージェント選択**: Claude Code・OpenClaw を選択
- **インストール方法**: Symlink（推奨）を選択

### 7-2. インストール済みスキル一覧

#### n8n-skills（czlonkowski）— 7スキル

```bash
npx skills add czlonkowski/n8n-skills
```

| スキル名 | 機能 |
|---------|------|
| `n8n-code-javascript` | n8n の Code ノード（JS）を Claude が記述・デバッグ |
| `n8n-code-python` | n8n の Code ノード（Python）を Claude が記述・デバッグ |
| `n8n-expression-syntax` | n8n 式構文の専門知識 |
| `n8n-mcp-tools-expert` | n8n × MCP ツール連携の専門知識 |
| `n8n-node-configuration` | 各ノードの設定方法を Claude が把握 |
| `n8n-validation-expert` | ワークフローのバリデーション |
| `n8n-workflow-patterns` | 設計パターン・ベストプラクティス |

→ **n8n ワークフローの構築・修正を Claude に直接依頼できるようになる**

#### find-skills（vercel-labs）— 自動提案スキル

n8n-skills インストール時に追加を推奨されるメタスキル。
Claude が「このタスクに使えるスキルがあるか？」を自動で調べて提案してくれる。

#### marketingskills（coreyhaines31）— 9スキル

```bash
npx skills add coreyhaines31/marketingskills
```

インストールしたスキル:

| スキル名 | 用途 |
|---------|------|
| `social-content` | X・Instagram の投稿文生成 |
| `copywriting` | アフィリLP・note 記事のコピー |
| `content-strategy` | 投稿テーマ・コンテンツ計画 |
| `ad-creative` | アフィリ広告クリエイティブ |
| `email-sequence` | メルマガ・ステップメール設計 |
| `ai-seo` | note・ブログの SEO 対策 |
| `seo-audit` | SEO 診断 |
| `marketing-psychology` | 購買心理を活用したコピー |
| `lead-magnets` | リードマグネット設計 |

#### apify-ultimate-scraper（apify）

```bash
npx skills add apify/agent-skills
```

Instagram・X・TikTok・YouTube・Amazon など 55 以上のプラットフォームのデータ収集が可能。
トレンド調査・競合分析・インフルエンサー発掘に活用できる。

> 使用には Apify の API キーが必要（無料枠あり）。

#### ai-image-generation（inferen-sh）

```bash
npx skills add inferen-sh/skills --skill ai-image-generation
```

FLUX・Gemini・Seedream など 50 以上の画像モデルに対応。
Instagram 静止画の生成プロンプトを Claude が直接実行できる。

> 使用には inference.sh の API キーが必要（従量課金）。

### 7-3. スキルのインストール場所

```
~/.agents/skills/          ← グローバルスキル（全エージェント共通）
~/.claude/skills/          ← Claude Code 専用スキル
```

### 7-4. 今後インストール予定のスキル

| スキル | 条件 |
|--------|------|
| Nanobanana Pro | Google AI Studio APIキー取得後 |
| Firecrawl | 正式スキルリポジトリ確認後（現在リンク未確定）|

---

## ステップ8：YouTube 自動化のセットアップ

### 8-1. Google Cloud Console の設定

1. [Google Cloud Console](https://console.cloud.google.com) でプロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で以下を有効化:
   - **YouTube Data API v3**
   - **YouTube Analytics API**
3. 「認証情報」→「OAuth 2.0 クライアント ID」を作成
   - アプリケーションの種類: **デスクトップアプリ**
   - クライアントIDとシークレットをコピー

### 8-2. リフレッシュトークンの取得

以下のURLをブラウザで開き、YouTubeアカウントで認可してコードを取得します。

```
https://accounts.google.com/o/oauth2/auth?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=urn:ietf:wg:oauth:2.0:oob&
  scope=https://www.googleapis.com/auth/youtube.upload+https://www.googleapis.com/auth/yt-analytics.readonly&
  response_type=code&
  access_type=offline
```

取得したコードでリフレッシュトークンを発行します:

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_AUTH_CODE" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob" \
  -d "grant_type=authorization_code"
# → "refresh_token": "1//xxxxx" をコピーして .env に設定
```

### 8-3. .env への追加

```env
YOUTUBE_CLIENT_ID=xxxxx.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=xxxxx
YOUTUBE_REFRESH_TOKEN=1//xxxxx
YOUTUBE_CHANNEL_ID=UCxxxxx   # YouTube Studio の URL から確認
```

### 8-4. 動画ファイルのパス設定

アップロードする動画を用意したら、ドラフトファイルの `videoPath` に設定します。

```bash
# 例: 今日のショート動画のパスを設定
node -e "
import fs from 'fs';
const p = 'youtube/drafts/$(date +%Y-%m-%d)/short.json';
const d = JSON.parse(fs.readFileSync(p));
d.videoPath = '/path/to/your/short_video.mp4';
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log('videoPath set');
" --input-type=module
```

または Bridge Server 経由でアップロードトリガー時に直接指定:

```bash
curl -X POST http://localhost:3001/api/youtube/upload \
  -H "Content-Type: application/json" \
  -d '{ "type": "short", "videoPath": "/path/to/video.mp4" }'
```

### 8-5. n8n ワークフローのインポート

`n8n/workflows/` の以下3ファイルをインポートして Active にする:

| ファイル | 内容 |
|---------|------|
| `youtube-short-daily.json` | 月曜リサーチ・毎日台本生成・平日15:00投稿 |
| `youtube-long-weekly.json` | 木曜台本生成・金曜15:00投稿 |
| `youtube-analytics.json` | 毎日23:30にAnalytics収集 |

> 動画ファイル生成（Renoise等）が自動化されるまでは
> アップロードワークフローのActive ONは保留してください。
> 台本生成・Analytics収集は先行してActive ONにできます。

### 8-6. 動作確認

```bash
# リサーチ（Playwright でYouTubeトレンド収集）
curl -X POST http://localhost:3001/api/youtube/research

# ショート台本生成
curl -X POST http://localhost:3001/api/youtube/generate \
  -H "Content-Type: application/json" \
  -d '{ "type": "short", "topic": "AIツール活用術" }'

# 生成結果を確認
cat youtube/drafts/$(date +%Y-%m-%d)/short.json | jq '.titles, .script[:200]'

# Analytics収集（認証設定後）
curl -X POST http://localhost:3001/api/youtube/collect
```

### 8-7. YouTube コンテンツ構成（週次計画）

`youtube/queue/weekly_plan.json` でテーマを週単位で管理できます。

```json
{
  "2026-04-14": { "theme": "Claude Codeで副業月10万円", "type": "short" },
  "2026-04-15": { "theme": "AIツール5選2026年版", "type": "short" },
  "2026-04-17": { "theme": "生成AI完全活用ガイド", "type": "long" }
}
```

設定がない日は曜日でテーマが自動ローテーションされます。

### 8-8. YouTube → 他SNS 横展開フロー

1本のYouTube動画からコンテンツを量産します:

```
YouTube動画アップ
  ↓
[COO へ指示]「YouTube横展開して」
  ↓ 並列実行
  ├── x-writer:    動画要約ツイート（140字）→ publisher で即投稿
  ├── note-writer: 台本を記事化（2000〜3000字）→ 下書き保存
  └── insta-writer: ショート版キャプション → publisher で投稿
```

---

## 未設定コンポーネント（今後の作業）

### Instagram Graph API（2アカウント対応）

#### アカウント構成

| アカウント | 用途 | 環境変数 |
|-----------|------|---------|
| アカウント① | AI副業系発信 | `INSTAGRAM_ACCESS_TOKEN_1` / `INSTAGRAM_BUSINESS_ACCOUNT_ID_1` |
| アカウント② | アフィリエイト・集客特化 | `INSTAGRAM_ACCESS_TOKEN_2` / `INSTAGRAM_BUSINESS_ACCOUNT_ID_2` |

#### 取得手順

1. [developers.facebook.com](https://developers.facebook.com) でアプリを作成（1つで2アカウント管理可）
2. Instagram Graph API を有効化
3. Graph API Explorer でアカウントごとに長期アクセストークンを取得（60日有効）
4. `.env` に追加:

```env
# Instagram アカウント①（AI副業系）
INSTAGRAM_ACCESS_TOKEN_1=EAAG...
INSTAGRAM_BUSINESS_ACCOUNT_ID_1=17841XXXXXXXXX

# Instagram アカウント②（アフィリ集客）
INSTAGRAM_ACCESS_TOKEN_2=EAAG...
INSTAGRAM_BUSINESS_ACCOUNT_ID_2=17841XXXXXXXXX
```

#### 動作確認

```bash
# アカウント①の生成テスト
curl -X POST http://localhost:3001/api/instagram/generate \
  -H "Content-Type: application/json" \
  -d '{"account": 1}'

# アカウント②の生成テスト
curl -X POST http://localhost:3001/api/instagram/generate \
  -H "Content-Type: application/json" \
  -d '{"account": 2}'
```

#### ドラフトの保存場所

```
instagram/drafts/
  account1/{date}/post.json   ← AI副業系
  account2/{date}//post.json  ← アフィリ集客
```

#### コンテンツ計画ファイル

週次テーマはアカウントごとに管理します:

```
instagram/queue/
  weekly_plan_1.json   ← AI副業系テーマ計画
  weekly_plan_2.json   ← アフィリ集客テーマ計画
```

フォーマット:
```json
{
  "2026-04-14": { "theme": "Claude Codeで副業月10万円", "buzzTypeId": "G" },
  "2026-04-15": { "theme": "AIツール5選2026年版", "buzzTypeId": "F" }
}
```

> 設定前でも `instagram/generate.js` は動作します（drafts に保存のみ）。

### Nanobanana Pro（AI画像生成）

画像生成プロンプトは `instagram/drafts/{日付}/post.json` に保存済みです。
APIキー取得後に以下でスキルをインストール:

```bash
gh repo clone feedtailor/ccskill-nanobanana ~/.claude/skills/nanobanana
```

### Renoise（AI動画生成）

Reels台本は `post.json` の `reelsScript` フィールドに保存済みです。
APIキー取得後:

```bash
npm install -g @renoiseai/cli
renoise generate --script "台本テキスト"
```

### X 追加アカウント（将来の拡張）

計画中のアカウント:
- `@ai_post` ← 現在稼働（AI発信）
- `@affi_post` ← アフィリエイト専用（準備中）
- `@kyaku_post` ← 集客専用（準備中）

追加時は `n8n/workflows/x-process.json` を複製して
`POST /api/x/process?account=affi` のようにアカウントを分岐させます。

---

## ステップ9：別PCへの環境再現チェックリスト

このセクションは **別のPCにまったく同じ環境を再現する**ための完全な手順です。
ステップ1〜8だけでは再現できない設定（スキル・ツール・MCP・Hooks・Zellij）を網羅しています。

---

### 9-1. システムツール

```bash
# Node.js 18+（fnm 推奨）
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 20 && fnm use 20

# ffmpeg（YouTube動画処理に必要）
sudo apt install -y ffmpeg

# Zellij（ターミナルマルチプレクサ）
bash <(curl -L https://zellij.dev/launch)

# Claude Code CLI
npm install -g @anthropic-ai/claude-code
```

---

### 9-2. Playwright + ブラウザのインストール

```bash
cd /path/to/automation

# 通常Playwrightブラウザ（YouTube・note・Analytics用）
npx playwright install chromium

# playwright-extra + stealth（X.com ログイン・セッション管理用）
npm install playwright-extra puppeteer-extra-plugin-stealth
```

> `playwright-extra` は X のログインに必須。`chromium` はインストール済みのものを共有します。

---

### 9-3. Lightpanda（高速ヘッドレスブラウザ）

YouTube リサーチ・note リサーチなど、ログイン不要のスクレイピングに使用します。
通常の Playwright の **9倍高速・1/16メモリ**。

```bash
# ダウンロード（x86_64 Linux）
curl -L -o ~/.local/bin/lightpanda \
  https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux

chmod +x ~/.local/bin/lightpanda

# 動作確認
~/.local/bin/lightpanda --help
```

> Lightpanda が見つからない場合は自動的に通常の Playwright にフォールバックします。
> `shared/lightpanda.js` の `LP_BINARY_CANDIDATES` に検索パスが定義されています。

---

### 9-4. xurl（X API CLIツール）

OpenClaw にバンドルされているため、**OpenClaw をインストールすると自動的に使えます**。
OpenClaw なしで単独使用する場合:

```bash
# OpenClaw 経由（推奨）
npm install -g openclaw
# → xurl が PATH に追加される

# 動作確認
xurl whoami
```

---

### 9-5. Claude Code スキルのインストール

スキルは `~/.agents/skills/` に配置します。

#### n8n-skills（n8n ワークフロー構築支援）

```bash
npx skills add czlonkowski/n8n-skills
# → インタラクティブ画面: スペースキーで全選択 → Enter → Claude Code & OpenClaw → Symlink
```

インストールされるスキル: `n8n-code-javascript` / `n8n-code-python` / `n8n-expression-syntax` /
`n8n-mcp-tools-expert` / `n8n-node-configuration` / `n8n-validation-expert` / `n8n-workflow-patterns`

#### marketingskills（SNSコンテンツ生成）

```bash
npx skills add coreyhaines31/marketingskills
```

インストールされるスキル: `social-content` / `copywriting` / `content-strategy` / `ad-creative` /
`email-sequence` / `ai-seo` / `seo-audit` / `marketing-psychology` / `lead-magnets`

#### apify（データスクレイピング）

```bash
npx skills add apify/agent-skills
```

#### ai-image-generation（画像生成）

```bash
npx skills add inferen-sh/skills --skill ai-image-generation
```

#### caveman（トークン削減・会話圧縮）

`npx skills add` 非対応のため git clone でインストール:

```bash
git clone https://github.com/JuliusBrussee/caveman.git ~/.agents/skills/caveman
```

使い方: Claude Code で `/caveman` と入力するとトークン使用量を約75%削減できます。

#### ffmpeg-video-editing（動画編集支援）

```bash
mkdir -p ~/.agents/skills/ffmpeg-video-editing
curl -L -o ~/.agents/skills/ffmpeg-video-editing/SKILL.md \
  "https://raw.githubusercontent.com/benchflow-ai/skillsbench/main/tasks/video-filler-word-remover/environment/skills/ffmpeg-video-editing/SKILL.md"
```

#### find-skills（スキル自動提案）

```bash
npx skills add vercel-labs/find-skills
```

#### スキル確認

```bash
ls ~/.agents/skills/
# n8n-code-javascript  n8n-code-python  n8n-expression-syntax
# n8n-mcp-tools-expert  n8n-node-configuration  n8n-validation-expert
# n8n-workflow-patterns  find-skills  social-content  copywriting
# content-strategy  ad-creative  email-sequence  ai-seo  seo-audit
# marketing-psychology  lead-magnets  apify-ultimate-scraper
# ai-image-generation  caveman  ffmpeg-video-editing
```

---

### 9-6. MCP サーバー設定

MCP（Model Context Protocol）は Claude Code から外部サービスを直接操作できる仕組みです。  
接続方法は2種類あります。

#### 種類A: claude.ai アカウント管理 MCP（ブラウザで設定）

以下の MCP は claude.ai の設定画面からアカウントに連携するだけで使えます。ファイル設定不要。

| MCP | 状態 | 用途 |
|-----|------|------|
| Gmail | ✅ | メール送受信・下書き・検索 |
| Twitter / X（`@enescinar/twitter-mcp`）| ✅ | ツイート投稿・検索（検索は有料のため使用禁止） |
| aidesigner | ✅ | テキスト指示から HTML/LP を生成 |
| Vercel | ⚠️ 要認証 | デプロイ・ログ確認（`! vercel login` 後に有効） |

> claude.ai 設定画面 → Integrations → 各サービスを Connect

#### 種類B: ローカル設定 MCP（`~/.claude.json`）

```json
{
  "mcpServers": {
    "x": {
      "command": "/path/to/automation/scripts/x-mcp-start.sh"
    }
  }
}
```

> **現状**: ローカルの `x` MCP スクリプトは起動失敗中（要調査）。  
> X の操作は `xurl` CLI と Playwright で代替しているため実害なし。

> **注意（共通）**: X MCP の `search_tweets` は有料API（402エラー）のため使用禁止。  
> 投稿・いいねは `xurl` CLI 経由で実行し、検索は Playwright で代替しています。

---

### 9-7. Claude Code Hooks 設定

Hooks はツール実行前後に自動でコマンドを走らせる仕組みです。  
設定ファイル: `~/.claude/settings.json` の `hooks` セクション。

スクリプトは `~/.claude/scripts/hooks/` と `~/.claude/hooks/` に格納されています。

**現在 Active なフック一覧:**

| タイミング | フック | 何をするか |
|-----------|-------|----------|
| PreToolUse（Bash） | `prevent-dangerous-bash.py` | `rm -rf` 等の破壊的コマンドをブロック |
| PreToolUse（Bash） | `block-no-verify` | `git --no-verify` を禁止 |
| PreToolUse（Write/Edit） | `config-protection.js` | `.env` 等の設定ファイルへの上書きを防止 |
| PreToolUse（Edit/Write） | `suggest-compact.js` | コンテキスト肥大時に `/compact` を提案 |
| PreToolUse（Edit/Write/MultiEdit） | `security_reminder_hook.py` | セキュリティリスクを事前警告 |
| PreToolUse（mcp__\*） | `mcp-health-check.js` | MCP 実行前にサーバー接続を確認 |
| PostToolUse（Write/Edit/MultiEdit） | `post-edit-dev-reminder.py` | 編集後に lint / build 確認をリマインド |
| PostToolUse（Edit） | `post-edit-format.js` | コードを自動フォーマット |
| PostToolUse（Edit） | `post-edit-console-warn.js` | `console.log` の残留を警告 |
| PostToolUse（Bash） | `post-bash-pr-created.js` | PR 作成後の後処理 |
| PreCompact | `pre-compact.js` | `/compact` 前に状態を保存 |
| Stop | `session-end.js` | セッション終了時の後処理 |
| Stop | `cost-tracker.js` | API コストを自動記録 |
| Stop | `evaluate-session.js` | セッションから再利用パターンを抽出 |
| Stop | `linux-notify.js` | 作業完了をデスクトップ通知 |

**`~/.claude/settings.json` の `hooks` セクション（別PCへの再現時に貼り付ける）:**

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "$HOME/.claude/hooks/prevent-dangerous-bash.py" }]
    },
    {
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "npx block-no-verify@1.1.2" }]
    },
    {
      "matcher": "Write|Edit",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"pre:config-protection\" \"scripts/hooks/config-protection.js\" \"standard,strict\"", "timeout": 5 }]
    },
    {
      "matcher": "Edit|Write",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"pre:edit-write:suggest-compact\" \"scripts/hooks/suggest-compact.js\" \"standard,strict\"" }]
    },
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [{ "type": "command", "command": "python3 /home/rascal/.claude/plugins/marketplaces/claude-plugins-official/plugins/security-guidance/hooks/security_reminder_hook.py", "timeout": 8 }]
    },
    {
      "matcher": "mcp__*",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"pre:mcp-health-check\" \"scripts/hooks/mcp-health-check.js\" \"standard,strict\"", "timeout": 10 }]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "Write|Edit|MultiEdit",
      "hooks": [{ "type": "command", "command": "$HOME/.claude/hooks/post-edit-dev-reminder.py" }]
    },
    {
      "matcher": "Edit",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"post:edit:format\" \"scripts/hooks/post-edit-format.js\" \"strict\"" }]
    },
    {
      "matcher": "Edit",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"post:edit:console-warn\" \"scripts/hooks/post-edit-console-warn.js\" \"standard,strict\"" }]
    },
    {
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"post:bash:pr-created\" \"scripts/hooks/post-bash-pr-created.js\" \"standard,strict\"" }]
    }
  ],
  "PreCompact": [
    {
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"pre:compact\" \"scripts/hooks/pre-compact.js\" \"standard,strict\"" }]
    }
  ],
  "Stop": [
    {
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"stop:session-end\" \"scripts/hooks/session-end.js\" \"minimal,standard,strict\"", "timeout": 10, "async": true }]
    },
    {
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/run-with-flags.js\" \"stop:cost-tracker\" \"scripts/hooks/cost-tracker.js\" \"minimal,standard,strict\"", "timeout": 10, "async": true }]
    },
    {
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/evaluate-session.js\"", "timeout": 15, "async": true }]
    },
    {
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/linux-notify.js\"", "timeout": 5, "async": true }]
    }
  ]
}
```

> **パスの注意**: `security_reminder_hook.py` のパスはユーザーホームに依存します。  
> 別PCに再現する場合は `/home/rascal/` を実際のホームディレクトリに置き換えてください。

---

### 9-7-1. Claude Code プラグイン設定

プラグインはスラッシュコマンド・フック・スキルをまとめてインストールできる仕組みです。  
設定ファイル: `~/.claude/settings.json` の `plugins` セクション。

**インストール:**

```bash
# 公式プラグインを一括取得（OpenClaw同梱のため追加インストール不要の場合あり）
# プラグインディレクトリ確認
ls ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/
```

**`~/.claude/settings.json` の `plugins` セクション（推奨セット）:**

```json
"plugins": [
  "commit-commands",
  "pr-review-toolkit",
  "code-review",
  "feature-dev",
  "claude-md-management",
  "security-guidance",
  "hookify",
  "typescript-lsp"
]
```

**有効化後に使えるスラッシュコマンド:**

| コマンド | プラグイン | 何をするか |
|---------|-----------|----------|
| `/commit` | commit-commands | ステージ確認→コミットメッセージ生成→git commit まで一括 |
| `/commit-push-pr` | commit-commands | コミット→push→PR 作成まで一括 |
| `/clean_gone` | commit-commands | リモート削除済みローカルブランチを一括削除 |
| `/review-pr` | pr-review-toolkit | 複数エージェントで PR を多角的にレビュー |
| `/code-review` | code-review | PR を指定して自動コードレビュー |
| `/feature-dev` | feature-dev | コードベース理解→設計→実装の一連フローをガイド |
| `/revise-claude-md` | claude-md-management | セッションの学びを CLAUDE.md に自動反映 |
| `/hookify` | hookify | 会話から「してほしくない動作」を検出してフックを生成 |

---

### 9-8. Zellij レイアウトのセットアップ

Zellij はタブ・ペイン分割でターミナルを整理するツールです。

```bash
# レイアウトディレクトリを作成
mkdir -p ~/.config/zellij/layouts

# automation.kdl をコピー（このリポジトリには含まれていません）
# → 別PCのファイルを手動コピー or 以下の内容で作成:
#   ~/.config/zellij/layouts/automation.kdl
```

**automation.kdl のタブ構成（8タブ）:**

| タブ名 | 用途 |
|-------|------|
| 司令部 | claude（タスク分解・全体指示） |
| 処理ライン | リサーチ / 実行（2ペイン） |
| 調査 | ライブラリ調査・仕様確認 |
| 投稿 | 投稿管理・コンテンツ確認 |
| YouTube | 台本生成 / アップロード（2ペイン） |
| n8n | ワークフロー管理（localhost:5678）/ ログ（2ペイン） |
| OpenClaw | Telegram Bot 操作（localhost:8080） |
| ログ | 実行ログ / エラー（2ペイン） |

起動コマンド:

```bash
zellij --layout ~/.config/zellij/layouts/automation.kdl
```

---

### 9-9. 環境再現チェックリスト（最終確認）

```bash
# ① Node.js
node --version          # v18+ であること

# ② npm パッケージ
cd /path/to/automation && npm install

# ③ Playwright ブラウザ
npx playwright install chromium

# ④ Lightpanda
~/.local/bin/lightpanda --help

# ⑤ xurl（OpenClaw経由）
xurl whoami

# ⑥ スキル確認
ls ~/.agents/skills/ | wc -l   # 21以上あること

# ⑦ MCP 確認（X MCP）
cat ~/.claude.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('mcpServers', {}))"

# ⑧ ffmpeg
ffmpeg -version 2>&1 | head -1

# ⑨ プラグイン確認
ls ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ | wc -l  # 30以上
python3 -c "import json; d=json.load(open('/home/rascal/.claude/settings.json')); print('plugins:', d.get('plugins', []))"

# ⑩ Hooks 確認
python3 -c "import json; d=json.load(open('/home/rascal/.claude/settings.json')); print('hook types:', list(d.get('hooks',{}).keys()))"

# ⑪ Bridge Server 起動テスト
npm run bridge &
sleep 2 && curl http://localhost:3001/health

# ⑫ 環境変数確認
node -e "require('dotenv/config'); console.log('ANTHROPIC:', !!process.env.ANTHROPIC_API_KEY, '| X_API_KEY:', !!process.env.X_API_KEY)"

# ⑬ notify-send（デスクトップ通知）
notify-send "テスト" "Claude Code 通知テスト" && echo "✅ OK" || echo "❌ notify-send not found (sudo apt install libnotify-bin)"
```

全項目が通れば環境再現完了です。

---

## トラブルシューティング

### Bridge Server に接続できない

```bash
# 起動確認
curl http://localhost:3001/health

# 起動されていない場合
npm run bridge
```

### n8n が起動しない

```bash
# ポート競合確認
lsof -i :5678

# 別ポートで起動
N8N_PORT=5679 npm run n8n
```

### OpenClaw が起動しない / Telegram Bot が応答しない

```bash
# 設定確認
openclaw doctor

# ログ確認
openclaw start --verbose

# デバイス承認（ゲートウェイ経由アクセス時）
openclaw devices list
openclaw devices approve <request-id>
```

### xurl のクレジット不足エラー

```
CreditsDepleted: API credits have been depleted
```

**原因**: `xurl search` / `xurl timeline` はX API有料クレジットが必要。  
**対処**: `like.js` は自動的に空配列を返してスキップします（エラーにはなりません）。  
検索機能が必要な場合は X API Basic プランへのアップグレードを検討してください。

### Claude API エラー

```bash
# APIキーの確認
echo $ANTHROPIC_API_KEY

# .env が読み込まれているか確認
node -e "require('dotenv/config'); console.log(process.env.ANTHROPIC_API_KEY)"
```

---

## コスト概算

| 項目 | 費用 | 備考 |
|------|------|------|
| Claude API（Haiku）| 約$1〜3/月 | ツイート生成・ショート台本・いいね判定 |
| Claude API（Sonnet）| 約$5〜12/月 | note記事・長尺台本・レビュー |
| X API | 無料〜$100/月 | 投稿・いいねは無料枠内 |
| YouTube Data API v3 | 無料 | 1万クォータ/日（アップロードは1600消費）|
| YouTube Analytics API | 無料 | クォータ消費なし |
| n8n | 無料 | セルフホスト |
| OpenClaw | 無料 | セルフホスト |

> X 投稿・いいねは無料枠内で動作します。YouTube アップロードは1日約6本まで無料クォータ内です。

---

## セキュリティ注意事項

- `.env` は絶対に Git にコミットしない
- `openclaw.json` の Bot Token・Auth Token は第三者に公開しない
- OpenClaw の `allowFrom: ["*"]` は自分専用Bot運用時のみ許容（公開Botには使わない）
- X API のアクセストークンは定期的にローテーションする

---

## まとめ：システム稼働後のルーティン

### 毎日（自動）
- 06:00 YouTube トレンドリサーチ（月曜のみ）
- 07:00 X トレンドリサーチ
- 08:00 / 12:00 / 22:00 Instagram コンテンツ生成
- 08:30 / 12:30 / 18:30 ツイート投稿
- 09:00 YouTube ショート台本生成
- 12:00 / 18:00 いいね自動化
- 15:00 YouTube ショートアップロード（平日・videoPath設定済みの場合）
- 22:00 / 23:00 エンゲージメント分析
- 23:30 YouTube Analytics 収集

### 週1回（手動 or 半自動）
- Telegram → 「note週次フロー」
- AI生成の下書きを確認 → note に手動公開
- 木曜: YouTube 長尺台本生成（自動）→ 動画編集（手動）
- 金曜: YouTube 長尺アップロード（自動・videoPath設定済みの場合）
- Telegram → 「YouTube横展開して」→ X/note/Instagram に自動配信

### 月1回
- `instagram/queue/weekly_plan.json` を更新
- `youtube/queue/weekly_plan.json` を更新
- X / YouTube エンゲージメントレポートを確認
- APIコスト確認・必要に応じてモデル見直し
