# n8n セットアップガイド

## 起動

```bash
cd /home/rascal/work/automation
chmod +x start.sh
./start.sh
```

- Bridge Server: http://localhost:3001/health
- n8n UI:        http://localhost:5678

---

## ワークフローのインポート手順

1. http://localhost:5678 を開く
2. 左メニュー **Workflows** → **Add Workflow**
3. 右上の **「...」** → **Import from File**
4. `n8n/workflows/` 以下のJSONを1つずつ選択してインポート

### インポートするファイル（8本）

| ファイル | スケジュール | 内容 |
|---------|------------|------|
| `x-research.json`      | 毎日 07:00               | X トレンドリサーチ → キュー積み |
| `x-process.json`       | 毎日 08:30 / 12:30 / 18:30 | ツイート生成・投稿 |
| `x-like.json`          | 毎日 12:00 / 18:00       | スコア上位ツイートにいいね |
| `note-research.json`   | 月曜 08:00               | note トレンドリサーチ |
| `note-generate.json`   | 月曜 10:00〜11:00        | 記事生成 → ヘッダー画像生成 |
| `note-post.json`       | 火曜 10:00               | note下書き保存 → 15分後X告知 |
| `instagram-daily.json` | 毎日 08:00 / 12:00 / 22:00 | キャプション生成・投稿・収集 |
| `analytics-daily.json` | 毎日 22:00 / 23:00       | X収集・バズ分析 |

5. インポート後、各ワークフローを開いて **Active** トグルをONにする

---

## 動作確認

Bridge Server の疎通確認:

```bash
# ヘルスチェック
curl http://localhost:3001/health

# X リサーチ手動実行
curl -X POST http://localhost:3001/api/x/research

# Instagram キャプション生成テスト
curl -X POST http://localhost:3001/api/instagram/generate
```

---

## n8n データの永続化

n8n のデータ（ワークフロー設定・実行履歴）は `n8n/data/` に保存されます。
インポートしたワークフローはこのディレクトリに自動保存されるため、
`n8n/workflows/*.json` はソース管理用のマスターコピーです。

---

## Instagram アカウント準備（未設定の場合）

1. Instagram Creator アカウントを作成
2. Facebook Business Manager で Facebook Page を作成
3. Instagram アカウントと Facebook Page を連携
4. Meta Developers でアプリを作成 → Instagram Graph API を有効化
5. アクセストークンを取得して `.env` に設定:

```env
INSTAGRAM_ACCESS_TOKEN=...
INSTAGRAM_BUSINESS_ACCOUNT_ID=...（数字のID）
```

設定前は `instagram/post.js` が `status: pending` でドラフト保存します（エラーにはなりません）。

---

## X 追加アカウント対応（準備でき次第）

`x/pipeline.js` の TwitterClient をアカウントごとに分岐させます。
ワークフロー側は `n8n/workflows/x-process.json` を複製して
POST先を `/api/x/process?account=affi` のように変えるだけです。
