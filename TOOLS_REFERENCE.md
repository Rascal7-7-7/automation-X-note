# ツール・スキル リファレンス

> 導入済みのスキル・MCP・Hooks・エージェントの全一覧。  
> 「何が使えるか」「どう使うか」「自動化への応用」を網羅。

---

## 目次

1. [スラッシュコマンド（即使えるもの）](#1-スラッシュコマンド即使えるもの)
2. [スキル ── `~/.agents/skills/`](#2-スキル-agentsskills)
3. [スキル ── `~/.claude/skills/`](#3-スキル-claudeskills)
4. [MCP サーバー](#4-mcp-サーバー)
5. [Hooks（自動実行フック）](#5-hooks自動実行フック)
6. [プラグイン（Plugin）](#6-プラグインplugin)
7. [Claude Code エージェント](#7-claude-code-エージェント自動起動)
8. [活用ロードマップ](#8-活用ロードマップ)

---

## 1. スラッシュコマンド（即使えるもの）

Claude Code のチャット欄で `/コマンド名` と入力するだけで起動。

### caveman 系（トークン削減）

| コマンド | 効果 | 使いどころ |
|---------|------|-----------|
| `/caveman` | 会話をトークン約75%削減（caveman語調） | 長い作業セッションのコスト削減 |
| `/caveman lite` | フィラー語除去のみ・文章は保持 | 軽い圧縮をかけたいとき |
| `/caveman ultra` | 極限圧縮。矢印・略語多用 | トークンをとにかく節約したいとき |
| `/caveman-commit` | コンパクトなコミットメッセージを自動生成 | `git commit` 前に毎回使う |
| `/caveman-review` | 1行完結のコードレビューコメント | PRレビュー時 |
| `/compress` | テキストの圧縮・要約 | 長い出力を短くしたいとき |

### Git 系（commit-commands プラグイン）

| コマンド | 効果 | 使いどころ |
|---------|------|-----------|
| `/commit` | ステージ確認 → コミットメッセージ生成 → `git commit` まで一括実行 | 日常的なコミット作業 |
| `/commit-push-pr` | コミット → push → PR 作成まで一括実行 | フィーチャーブランチを一気にマージ準備 |
| `/clean_gone` | リモートで削除済みのローカルブランチを一括削除 | ブランチ整理 |

### コードレビュー・開発系（各プラグイン）

| コマンド | 効果 | 使いどころ |
|---------|------|-----------|
| `/review-pr` | 複数エージェントで PR を多角的にレビュー | PR をマージ前に品質確認 |
| `/code-review` | GitHub PR を指定してコードレビュー | `gh` CLIと連携してレビューコメント投稿も可 |
| `/feature-dev` | コードベース理解→設計→実装の一連フローをガイド | 新機能開発の起点 |
| `/revise-claude-md` | セッションの学びを CLAUDE.md に自動反映 | 作業終了前に必ず実行すると記憶が蓄積される |

### フック・ツール系

| コマンド | 効果 | 使いどころ |
|---------|------|-----------|
| `/hookify` | 会話から「してほしくない動作」を検出しフックを自動生成 | 繰り返し発生するミスをフックで防止 |
| `/hookify configure` | フック設定を対話形式で調整 | 既存フックの修正 |
| `/hookify list` | 現在有効なフック一覧を表示 | フック確認 |

> **使用例:**
> ```
> /commit
> → git status を確認 → メッセージ提案 → 確認後コミット
>
> /review-pr
> → 現在のブランチの差分を複数エージェントがレビュー
>
> /revise-claude-md
> → 今日の作業で学んだことを CLAUDE.md に追記
> ```

---

## 2. スキル ── `~/.agents/skills/`

Claude Code・OpenClaw 両方から使えるグローバルスキル。

### SNS・コンテンツ生成系

| スキル名 | 何ができるか | 自動化への活用案 | 必要なもの |
|---------|------------|----------------|-----------|
| `social-content` | X・Instagram 投稿文の生成支援 | x-writer / insta-writer の補完 | なし |
| `content-strategy` | 投稿テーマ・月次コンテンツ計画の立案 | 月次 weekly_plan.json の作成 | なし |
| `ad-creative` | 広告コピー・バナー文章の生成 | Instagram 広告キャプションの強化 | なし |
| `copywriting` | アフィリLP・note 記事のコピー | note 記事・プロフィール文の最適化 | なし |
| `marketing-psychology` | 購買心理を使ったコピー術 | X・Instagram 投稿の CV 率向上 | なし |
| `email-sequence` | メルマガ・ステップメールの設計 | note 読者への EMAIL 導線設計 | なし |
| `lead-magnets` | 無料特典（リードマグネット）の設計 | プロフ URL リンクの CVR 改善 | なし |

### SEO・リサーチ系

| スキル名 | 何ができるか | 自動化への活用案 | 必要なもの |
|---------|------------|----------------|-----------|
| `ai-seo` | note・ブログの SEO 対策 | note 記事のキーワード最適化 | なし |
| `seo-audit` | SEO 診断・改善提案 | 公開済み note 記事の診断 | なし |
| `apify-ultimate-scraper` | Instagram・TikTok・YouTube など 55 媒体のデータ収集 | 競合分析・トレンドリサーチ強化 | Apify API キー |

### 動画・画像生成系

| スキル名 | 何ができるか | 自動化への活用案 | 必要なもの |
|---------|------------|----------------|-----------|
| `ai-image-generation` | FLUX・Gemini 等 50 モデルで画像生成 | Instagram 画像の自動生成 | inference.sh API キー |
| `nano-banana-pro` | Gemini 3 Pro で高品質画像生成 | YouTube 動画背景・サムネイル自動生成 | GEMINI_API_KEY（設定済み）|
| `ffmpeg-video-editing` | 動画カット・結合・エンコード・字幕 | YouTube 動画の自動編集 | インストール済み |

### n8n ワークフロー構築系（7本）

n8n のワークフロー作成・修正を Claude に直接依頼できるようになるスキル群。

| スキル名 | 何ができるか |
|---------|------------|
| `n8n-code-javascript` | n8n Code ノード（JS）の記述・デバッグ |
| `n8n-code-python` | n8n Code ノード（Python）の記述・デバッグ |
| `n8n-expression-syntax` | n8n 式構文（`{{ $json.field }}`等）の専門知識 |
| `n8n-mcp-tools-expert` | n8n × MCP ツール連携の設計 |
| `n8n-node-configuration` | 各ノード（HTTP Request・Cron 等）の設定方法 |
| `n8n-validation-expert` | ワークフローのバリデーション・エラー対処 |
| `n8n-workflow-patterns` | 設計パターン・ベストプラクティス |

### ユーティリティ

| スキル名 | 何ができるか |
|---------|------------|
| `find-skills` | 「このタスクに使えるスキルがあるか？」を自動検索・提案 |

---

## 3. スキル ── `~/.claude/skills/`

Claude Code 専用スキル。SNS自動化系スキルと重複するものを除いた主要スキル。

### 本業開発向け

| スキル名 | 何ができるか |
|---------|------------|
| `dev-core-review` | 可読性・保守性・セキュリティ・拡張性のコードレビュー |
| `git-workflow` | ブランチ戦略・コミット規約・PR 作成の全般サポート |
| `security-review` | OWASP Top 10・認証・API キー漏洩チェック |
| `tdd-workflow` | テスト駆動開発（RED→GREEN→REFACTOR）のガイド |
| `e2e-testing` | Playwright E2E テストの生成・実行 |
| `api-design` | REST API 設計・エンドポイント命名規則 |
| `docker-patterns` | Docker / Docker Compose のベストプラクティス |
| `deployment-patterns` | デプロイ戦略・CI/CD パターン |

### コンテンツ・マーケティング向け

| スキル名 | 何ができるか | 活用タイミング |
|---------|------------|-------------|
| `nanobanana` | Google Nano Banana Pro（Gemini 3 Pro）で画像生成 | Instagram 画像自動生成（要 Google AI Studio APIキー） |
| `market-research` | 市場調査・競合分析・業界インテリジェンス | SNS 戦略の立案・競合リサーチ |
| `article-writing` | 記事執筆の全般支援 | note 記事の品質向上 |
| `content-article-ops` | コンテンツ運用オペレーション | note 公開フローの標準化 |
| `mvp-product-builder` | MVP プロダクトの設計・構築支援 | 新機能・新サービスの立ち上げ |

---

## 4. MCP サーバー

Claude Code から外部サービスを直接操作できる連携機能。

### 接続済み・即使えるもの

#### Gmail MCP ✅

メールの送受信・下書き・検索を Claude Code から直接操作できる。

```
# 使用例（Claude Code に話しかけるだけ）
「週次レポートをメールで自分に送って」
「note の問い合わせメールを確認して」
「新規フォロワーへのウェルカムメールを下書きして」
```

| 操作 | 何ができるか |
|-----|------------|
| メール検索 | 件名・送信者・日付でメールを検索 |
| メール読み取り | 受信メールの内容確認 |
| 下書き作成 | メールの下書きを Claude が作成 |
| ラベル管理 | メールの整理・分類 |

#### Twitter / X MCP ✅

ツイートの投稿・検索が可能。ただし投稿は xurl 優先のため主に検索用。

```
# 注意: search_tweets は有料 API（402 エラー）のため使用禁止
# post_tweet は xurl に統一しているため不使用
# → 現状このMCPはほぼ待機中
```

#### aidesigner MCP ✅

テキスト指示からHTMLのUI・ランディングページを即座に生成。

```
# 使用例
「Instagram プロフィールのリンク先 LP を作って」
「note の記事一覧ページを作って」
「副業実績を見せるシンプルな1ページサイトを作って」
```

### 要設定のもの

#### Vercel MCP ⚠️（要認証）

デプロイ・ログ確認・ドメイン管理を Claude Code から操作できる。  
aidesigner で生成したページをそのままデプロイする用途に最適。

```bash
# 認証手順
! vercel login
```

#### x (local) ✗（設定ミス・要調査）

`~/.claude/scripts/x-mcp-start.sh` を起動スクリプトとして登録されているが、現在 Failed 状態。  
`@enescinar/twitter-mcp` ✅ とは別物。search_tweets は有料 API（402）のため使用禁止。

```bash
# 調査コマンド
cat ~/.claude/scripts/x-mcp-start.sh
# → スクリプトの内容を確認して原因を特定
```

---

## 5. Hooks（自動実行フック）

Claude Code がツールを使う前後に自動で走るスクリプト。

### 現在 Active なもの

#### PreToolUse（ツール実行前）

| フック | 何をしているか |
|-------|-------------|
| `prevent-dangerous-bash.py` | `rm -rf` 等の破壊的コマンドを自動ブロック |
| `block-no-verify` | `git --no-verify`（フック回避）を禁止 |
| `config-protection.js` | `.env` 等の設定ファイルへの上書きを防止 |
| `suggest-compact.js` | コンテキストが大きくなったら `/compact` を提案 |
| `security_reminder_hook.py` | Edit/Write/MultiEdit 前にセキュリティリスクを警告（security-guidance） |
| `mcp-health-check.js` | MCP ツール実行前にサーバー接続を自動確認 |

#### PostToolUse（ツール実行後）

| フック | 何をしているか |
|-------|-------------|
| `post-edit-dev-reminder.py` | ファイル編集後に「lint / build を確認して」とリマインド |
| `post-edit-format.js` | 編集後にコードを自動フォーマット |
| `post-edit-console-warn.js` | `console.log` が残っていると警告 |
| `post-bash-pr-created.js` | PR 作成後の後処理（通知等） |

#### PreCompact / Stop

| タイミング | フック | 何をしているか |
|-----------|-------|-------------|
| PreCompact | `pre-compact.js` | `/compact` 前に現在の状態を保存 |
| Stop | `session-end.js` | セッション終了時の後処理・サマリー |
| Stop | `cost-tracker.js` | Claude API の利用コストを自動記録 |
| Stop | `evaluate-session.js` | セッションから再利用可能なパターンを抽出・保存 |
| Stop | `linux-notify.js` | 作業完了時にデスクトップ通知（notify-send） |

---

### 未 Active（有効化できるもの）

`~/.claude/scripts/hooks/` に存在するが、まだ `settings.json` に追加されていないフック。

| フック | 何をするか | おすすめ度 |
|-------|----------|----------|
| `desktop-notify.js` | 長時間処理が完了したらデスクトップ通知 | ★★★ |
| `mcp-health-check.js` | セッション開始時に MCP 接続を自動チェック | ★★★ |
| `pre-bash-commit-quality.js` | コミット前にコード品質ゲートを実行 | ★★☆ |
| `evaluate-session.js` | セッション終了時に作業内容を自動評価・記録 | ★★☆ |
| `governance-capture.js` | 設計決定を自動でドキュメントに記録 | ★★☆ |
| `post-edit-typecheck.js` | TypeScript ファイル編集後に型チェックを自動実行 | ★☆☆ |
| `session-start.js` | セッション開始時に環境確認・初期化 | ★☆☆ |
| `quality-gate.js` | コード品質の総合チェックゲート | ★☆☆ |

> **有効化方法:** `~/.claude/settings.json` の `hooks` セクションに追記するだけ。  
> 「`desktop-notify` を有効化して」と Claude Code に頼めば自動で追記できます。

---

### プラグインフック（Plugin 側で定義・現在は未 Active）

以下はインストール済みプラグインが持つフックだが、プラグインが `settings.json` で有効化されていないため現在は動いていない。  
プラグインを有効化すると同時に適用される。

| プラグイン | フックタイミング | 何をするか |
|-----------|--------------|----------|
| `hookify` | PreToolUse / PostToolUse / Stop / UserPromptSubmit | `.local.md` に書いたルールをフックとして自動適用 |
| `ralph-loop` | Stop | ループ終了時の自己参照チェック・次ループ起動判定 |
| `security-guidance` | PreToolUse（Edit/Write/MultiEdit 時） | ファイル編集前にセキュリティリスクを警告 |
| `explanatory-output-style` | SessionStart | セッション開始時に「教育的説明スタイル」を適用 |
| `learning-output-style` | SessionStart | セッション開始時に「学習支援スタイル（interactive）」を適用 |

> **推奨**: `security-guidance` はコード編集時に毎回セキュリティ警告を出す有益なフック。  
> 有効化するには `settings.json` の `plugins` 配列にプラグイン名を追加してください。

---

## 6. プラグイン（Plugin）

`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/` にインストール済み。  
現在はすべて **未有効化**（`settings.json` の `plugins: []`）。

> **有効化方法:** `~/.claude/settings.json` に `"plugins": ["plugin-name"]` を追記する。

### 開発ワークフロー系（即有効化推奨）

| プラグイン | 提供するコマンド | 何ができるか | おすすめ度 |
|-----------|--------------|------------|----------|
| `commit-commands` | `/commit` `/commit-push-pr` `/clean_gone` | Git コミット・push・PR 作成の一括フロー | ★★★ |
| `pr-review-toolkit` | `/review-pr` | 複数エージェントで PR を多角的にレビュー | ★★★ |
| `code-review` | `/code-review` | PR を指定して自動コードレビュー | ★★★ |
| `feature-dev` | `/feature-dev` | コードベース理解→設計→実装の一連フローをガイド | ★★★ |
| `claude-md-management` | `/revise-claude-md` | セッションの学びを CLAUDE.md に自動反映 | ★★★ |

### フック・動作カスタマイズ系

| プラグイン | 提供するフック | 何ができるか | おすすめ度 |
|-----------|------------|------------|----------|
| `hookify` | PreToolUse / PostToolUse / Stop | 会話から「してほしくない動作」を検出しフックを自動生成 | ★★★ |
| `security-guidance` | PreToolUse（Edit時） | ファイル編集前にセキュリティ警告を表示 | ★★★ |
| `ralph-loop` | Stop | `/ralph-loop` でタスクを反復ループ実行（自動繰り返し） | ★★☆ |
| `explanatory-output-style` | SessionStart | 応答に教育的説明を常時追加するスタイル変更 | ★☆☆ |
| `learning-output-style` | SessionStart | 学習支援（interactive）スタイルに応答を変更 | ★☆☆ |

### コンテンツ・UI 生成系

| プラグイン | 提供するスキル | 何ができるか | おすすめ度 |
|-----------|------------|------------|----------|
| `playground` | skills/ | インタラクティブな HTML プレイグラウンドを生成 | ★★☆ |
| `frontend-design` | skills/ | 独自性のある高品質フロントエンドUI を生成 | ★★☆ |
| `claude-code-setup` | skills/ | コードベースを解析してフック・スキル・MCP を自動推薦 | ★★★ |

### 開発支援系

| プラグイン | 提供するもの | 何ができるか | おすすめ度 |
|-----------|-----------|------------|----------|
| `skill-creator` | skills/ | 新スキルの作成・既存スキルの改善・性能評価 | ★★☆ |
| `session-report` | skills/ | セッション終了時にアクティビティレポートを生成 | ★★☆ |
| `agent-sdk-dev` | `/new-sdk-app` + agents/ | Claude Agent SDK アプリ（Python/TS）の雛形生成 | ★★☆ |
| `mcp-server-dev` | skills/ | MCP サーバーの設計・実装支援 | ★★☆ |
| `code-simplifier` | agents/ | コードの複雑さを自動分析して簡素化提案 | ★☆☆ |

### LSP（言語サーバー）系

IDE のようなコード補完・型チェック・エラーハイライトを Claude Code に追加する。

| プラグイン | 対応言語 | おすすめ度 |
|-----------|--------|----------|
| `typescript-lsp` | TypeScript / JavaScript | ★★★（本業開発で必須） |
| `pyright-lsp` | Python | ★★☆ |
| `rust-analyzer-lsp` | Rust | ★☆☆ |
| `gopls-lsp` | Go | ★☆☆ |
| `ruby-lsp` | Ruby | ★☆☆ |
| `clangd-lsp` | C / C++ | ★☆☆ |
| `jdtls-lsp` | Java | ★☆☆ |
| `kotlin-lsp` | Kotlin | ★☆☆ |
| `lua-lsp` | Lua | ★☆☆ |
| `php-lsp` | PHP | ★☆☆ |
| `swift-lsp` | Swift | ★☆☆ |
| `csharp-lsp` | C# | ★☆☆ |

### その他

| プラグイン | 何ができるか |
|-----------|-----------|
| `math-olympiad` | 数学オリンピック問題の解法支援 |
| `example-plugin` | プラグイン開発用サンプル |
| `plugin-dev` | プラグイン自体の開発・デバッグ支援 |

> **即有効化推奨セット（SNS自動化 + 本業開発）:**
> ```json
> "plugins": [
>   "commit-commands",
>   "pr-review-toolkit",
>   "code-review",
>   "feature-dev",
>   "claude-md-management",
>   "security-guidance",
>   "typescript-lsp"
> ]
> ```

---

## 7. Claude Code エージェント（自動起動）

`~/.claude/agents/` に定義されたサブエージェント。  
複雑なタスクを依頼すると Claude Code が自動的に適切なエージェントを起動する。

| エージェント | 自動起動タイミング | 何をするか |
|-----------|----------------|----------|
| `planner` | 複雑な機能実装・設計変更を依頼したとき | 実装計画・タスク分解・リスク洗い出し |
| `architect` | アーキテクチャ判断・システム設計を依頼したとき | 技術選定・設計方針のアドバイス |
| `code-reviewer` | コードを書いた・修正したとき | 品質・セキュリティ・可読性のレビュー |
| `security-reviewer` | 認証・API・ユーザー入力を扱うコードを書いたとき | OWASP Top 10 脆弱性チェック |
| `tdd-guide` | 新機能・バグ修正を依頼したとき | テストファーストで実装をガイド |
| `doc-updater` | ドキュメント更新を依頼したとき | GUIDE.md・README の自動更新 |
| `refactor-cleaner` | 不要コードの整理・リファクタを依頼したとき | デッドコード削除・コード圧縮 |
| `performance-optimizer` | 処理が遅い・メモリ問題を報告したとき | ボトルネック特定・最適化提案 |
| `e2e-runner` | E2E テストを依頼したとき | Playwright テストの生成・実行 |
| `build-error-resolver` | ビルド失敗・型エラーが出たとき | エラーの自動修正 |
| `aidesigner-frontend` | UI・LP・ダッシュボードの作成を依頼したとき | aidesigner MCP でHTML生成 |
| `database-reviewer` | SQL・マイグレーション・スキーマを書いたとき | DB 設計・クエリの最適化 |

---

## 8. 活用ロードマップ

### フェーズ1：今すぐ使える（設定不要）

```
/caveman          → 毎回の作業開始時に入力してコスト削減
/caveman-commit   → git commit 前に毎回実行
market-research   → SNS戦略・競合リサーチを依頼するとき
content-strategy  → 月次コンテンツ計画の作成時
Gmail MCP         → 週次レポートの自動メール送信
aidesigner MCP    → note・SNSのリンク先 LP 作成
```

### フェーズ2：軽い設定で使える

```
desktop-notify フック有効化  → 長時間処理の完了通知
mcp-health-check フック有効化 → MCP接続の自動確認
ffmpeg インストール           → インストール済み
  → youtube/render.js で YouTube 動画自動生成（Nanobanana Pro + FFmpeg）
```

### フェーズ3：APIキー取得後

```
nanobanana（Google AI Studio）  → 設定済み。YouTube動画背景・Instagram画像自動生成で稼働中
ai-image-generation（inference.sh） → inference.sh APIキー取得後に追加可（50モデル対応）
apify-ultimate-scraper（Apify）    → 競合・トレンド分析強化
Vercel MCP（vercel login）         → aidesigner 生成ページの即デプロイ
```

### フェーズ4：自動化への統合

```
apify + market-research → リサーチエージェントの強化
nanobanana → youtube/render.js・instagram/generate.js に統合済み（稼働中）
ffmpeg → youtube/render.js で動画合成・テロップ・BGM処理（稼働中）
Gmail MCP → analytics の週次レポートをメール自動送信
```

---

> 各ツールの詳細なインストール・設定手順は [GUIDE.md](./GUIDE.md) を参照。  
> 「〇〇を今すぐ使えるようにして」と Claude Code に頼めば設定まで行います。
