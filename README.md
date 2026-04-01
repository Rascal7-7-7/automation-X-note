# X / note 半自動配信システム

X（Twitter）と note.com のコンテンツ配信を半自動化するシステムです。
リサーチ・記事生成・画像生成・X投稿は完全自動。note の公開だけワンクリックで完了します。

---

## システム構成

```
自動  リサーチ → 生成 → 画像生成 → 下書き保存 → 通知
手動                                              ↓
                                         ブラウザで「公開」を押す
```

---

## セットアップ

### 1. 依存パッケージのインストール

```bash
cd automation
npm install
npx playwright install chromium
```

### 2. 環境変数の設定

`.env` ファイルを作成してください。

```env
# 必須
ANTHROPIC_API_KEY=sk-ant-...
NOTE_EMAIL=your@email.com
NOTE_PASSWORD=yourpassword

# X API（未設定時はブラウザ経由で投稿）
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=

# 任意（DALL-E で画像生成する場合）
OPENAI_API_KEY=
```

### 3. note.com のログインセッションを保存

初回のみ、ブラウザを表示してログインします。

```bash
node note/post.js --headed
```

ログイン後、`.note-session.json` が生成されます。以降は自動でセッションを再利用します。

---

## 使い方

### 本番稼働（cron 自動実行）

```bash
MODE=prod node scheduler/index.js
```

バックグラウンドで常時起動する場合：

```bash
MODE=prod nohup node scheduler/index.js &
```

### 個別タスクを手動実行

```bash
# X リサーチ → キュー積み
MODE=dev DEV_TASK=x:enqueue node scheduler/index.js

# X ツイート生成（dev モードは投稿しない・確認のみ）
MODE=dev DEV_TASK=x:process node scheduler/index.js

# note 記事生成
MODE=dev DEV_TASK=note:generate node scheduler/index.js

# note 下書き保存 → ブラウザが自動で開く
MODE=dev DEV_TASK=note:post node scheduler/index.js
```

---

## note 公開手順（週1回・火曜）

スケジューラが自動で以下を実行します。

| 時刻 | 自動処理 |
|------|---------|
| 月曜 08:00 | トレンドリサーチ |
| 月曜 10:00 | 記事生成 |
| 月曜 11:00 | ヘッダー画像生成 |
| 火曜 10:00 | note.com に下書き保存 → ブラウザが開く |
| 火曜 10:15 | X に告知ツイートを投稿 |

**火曜10:00 にブラウザが自動で開きます。「公開」ボタンを押すだけで完了です。**

### 手動で通知・ブラウザ起動する場合

```bash
# 公開待ちの下書きをブラウザで開く
python3 note/notify.py --open

# デスクトップ通知を送る（クリックでブラウザが開く）
python3 note/notify.py

# 全下書きの状態を確認する
python3 note/notify.py --list
```

---

## X 投稿の仕組み

- **投稿頻度**: 1日最大5件（毎日08:30 / 12:30 / 18:30 の3回）
- **テーマ**: AI活用・個人開発・金融の3ドメイン
- **フィルタ**: ルール検証（140字・禁止語）→ AI レビュー → 投稿
- **いいね**: 1日2回、スコア上位ツイートに最大5件

---

## ディレクトリ構成

```
automation/
├── scheduler/
│   ├── index.js        cron スケジューラ
│   └── tasks.js        タスク定義（cron 式・名前）
├── x/
│   ├── research.js     X 検索・スコアリング
│   ├── pipeline.js     生成・検証・レビュー・投稿
│   ├── like.js         いいね自動化
│   └── note-promo.js   note 告知ツイート
├── note/
│   ├── research.js     トレンドリサーチ
│   ├── generate.js     記事生成
│   ├── image.js        ヘッダー画像生成
│   ├── post.js         note.com への下書き保存
│   ├── notify.py       ワンクリック公開ヘルパー（Python）
│   └── drafts/         生成済みドラフト（JSON + 画像）
├── analytics/
│   ├── logger.js       投稿ログ記録
│   ├── collect-x.js    X エンゲージメント収集
│   └── buzz-analyzer.js バズ分析・ヒント生成
├── shared/
│   ├── claude-client.js Anthropic SDK ラッパー
│   ├── queue.js         ファイルベース永続キュー
│   ├── daily-limit.js   日別投稿数制限
│   └── logger.js        共通ロガー
├── logs/               ログ・分析データ
├── .note-session.json  note.com セッション（自動生成）
├── .x-session.json     X セッション（自動生成）
├── README.md           本ファイル
└── SPEC.md             詳細仕様書
```

---

## トラブルシューティング

### note のログインが通らない

```bash
# セッションを削除して再ログイン
rm .note-session.json
node note/post.js --headed
```

### X 投稿が失敗する

```bash
# failed キューを確認
cat x/queue/failed.jsonl

# retry キューを手動処理
MODE=prod DEV_TASK=x:process node scheduler/index.js
```

### 今日の X 投稿数を確認

```bash
cat logs/daily-limit.json
```

### 下書きの状態を確認

```bash
python3 note/notify.py --list
```

---

## 詳細仕様

→ [SPEC.md](./SPEC.md)
