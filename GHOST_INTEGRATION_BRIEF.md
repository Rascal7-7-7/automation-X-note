# Ghost Integration Brief — SNS自動化への追加

作成: 2026-04-19

---

## 1. Ghostとは（自動化視点）

Ghost = 英語圏向けオープンソースパブリッシングプラットフォーム。
note.muの英語版・グローバル版として機能。

**自動化に使える理由:**
- Admin API → プログラマティック投稿可能（`POST /posts/`）
- ニュースレター機能内蔵 → メール配信まで自動化
- Stripe統合 → 有料サブスク収益化
- Webhook/Zapier対応
- 自己ホスト可（**完全無料**）
- `@tryghost/admin-api` npm パッケージで簡単連携

---

## 2. 既存automationシステムとの位置づけ

```
現在の配信チャネル:
  X (Twitter)    → 日本語ショートコンテンツ（3-5投稿/日）
  note.com       → 日本語長文記事（週1回、半手動）
  Instagram      → 画像・Reels（週3-5回）
  YouTube        → 動画・Shorts（毎日）

追加チャネル:
  Ghost          → 英語長文記事 + ニュースレター（週1-2回、全自動）
```

**Ghostの役割:**
- 日本語コンテンツの英語翻訳・再配信 → グローバルリーチ拡大
- ニュースレター読者リスト構築 → メール資産
- Stripe有料会員 → 英語圏収益化
- SEO（Google英語検索流入）

---

## 3. 技術仕様

### 3-1. Ghost自己ホスト（推奨）

**オプションA: VPS（推奨）**
```bash
# DigitalOcean/Vultr $6-12/月
# Ghost公式Dockerイメージ
docker run -d \
  -e url=https://yourdomain.com \
  -e database__client=sqlite3 \
  -v ghost-data:/var/lib/ghost/content \
  -p 2368:2368 \
  ghost:latest
```

**オプションB: ローカル（開発・テスト用）**
```bash
npm install -g ghost-cli
ghost install local
# → http://localhost:2368
```

### 3-2. Admin API 認証（JWT）

```javascript
const GhostAdminAPI = require('@tryghost/admin-api');

const api = new GhostAdminAPI({
    url: process.env.GHOST_URL,        // 例: https://yourblog.com
    key: process.env.GHOST_ADMIN_KEY,  // Ghost管理画面 → Settings → Integrations
    version: 'v5.0'
});
```

### 3-3. 投稿API

```javascript
// 記事投稿
await api.posts.add({
    title: 'Article Title',
    html: '<p>Content here</p>',
    status: 'published',              // 'draft' or 'published'
    tags: [{ name: 'AI' }, { name: 'Automation' }],
    custom_excerpt: 'Short summary',
    feature_image: 'https://...',     // ヘッダー画像URL
    newsletter: { id: 'newsletter_id' }  // ニュースレター配信する場合
}, { source: 'html' });
```

---

## 4. 実装計画

### ディレクトリ構造（note/を参考に）

```
automation/
└── ghost/
    ├── generate.js      # Claude Sonnet: 英語記事生成
    ├── post.js          # Ghost Admin API: 投稿
    ├── newsletter.js    # ニュースレター配信管理
    ├── research.js      # 英語圏トレンド調査（Reddit/HN/Product Hunt）
    ├── translate.js     # 日本語note記事 → 英語変換
    └── queue/
        └── ideas.jsonl  # 記事アイデアキュー
```

### 4-1. generate.js — コンテンツ生成戦略

**2パターン:**

**パターンA: 翻訳・リパーパス（工数少）**
```
日本語note記事 → Claude Sonnet翻訳 → 英語Ghost記事
週次noteと連動: note生成後 → 同テーマ英語版を自動生成
```

**パターンB: 独自英語コンテンツ（品質高）**
```
Reddit/HN/Product Hunt トレンド調査
→ Claude Sonnet 英語記事生成（1500-2500 words）
→ Ghost投稿 + ニュースレター配信
```

### 4-2. スケジュール案

```javascript
// scheduler/tasks.jsに追加
{
    name: 'ghost:generate',
    cron: '0 9 * * 2',    // 毎週火曜 9:00（note生成の翌日）
    task: () => require('../ghost/generate').run(),
    mode: ['prod']
},
{
    name: 'ghost:post',
    cron: '0 14 * * 2',   // 毎週火曜 14:00（生成後5時間後）
    task: () => require('../ghost/post').run(),
    mode: ['prod']
}
```

### 4-3. bridge/server.jsへの追加

```javascript
app.post('/api/ghost/post', async (req, res) => {
    const { title, html, tags, newsletter } = req.body;
    const result = await ghostPost({ title, html, tags, newsletter });
    res.json(result);
});
```

---

## 5. コンテンツ戦略

### ターゲットトピック（英語圏需要が高い）

```
1. AI副業・自動化 → "AI Side Hustle Automation"（月間検索50k+）
2. Claude Code Tips → 英語圏のdev向け（Twitter/X日本語版の英語展開）
3. Japan Tech Scene → 英語圏に日本のAI情報を届ける差別化ポジション
4. Passive Income AI → アフィリエイト × 英語圏
```

### 収益化ロードマップ

```
Phase 1（0-3ヶ月）: 無料記事のみ → 読者リスト構築
Phase 2（3-6ヶ月）: Stripe有料会員 ($5-15/月) → プレミアムコンテンツ
Phase 3（6ヶ月+）: スポンサー記事 + アフィリエイト統合
```

---

## 6. 必要な環境変数（.envに追加）

```bash
# Ghost
GHOST_URL=https://yourdomain.com      # or http://localhost:2368
GHOST_ADMIN_KEY=your_admin_api_key    # Ghost管理画面で取得
GHOST_NEWSLETTER_ID=newsletter_id     # ニュースレターID（任意）
```

---

## 7. 必要パッケージ（package.jsonに追加）

```bash
npm install @tryghost/admin-api
```

---

## 8. セットアップ手順（担当者向け）

### Step 1: Ghost自己ホスト立ち上げ

```bash
# ローカルテスト用
npm install -g ghost-cli
mkdir ghost-local && cd ghost-local
ghost install local
# http://localhost:2368/ghost/ でセットアップ
```

### Step 2: Admin API キー取得

```
Ghost管理画面（/ghost/）
→ Settings → Integrations → Add custom integration
→ Admin API Key をコピー → .envに設定
```

### Step 3: モジュール実装

```
ghost/generate.js → ghost/post.js の順に実装
scheduler/tasks.js に追加
bridge/server.js に追加
```

### Step 4: テスト

```bash
MODE=dev DEV_TASK=ghost:generate node scheduler/index.js
MODE=dev DEV_TASK=ghost:post node scheduler/index.js
```

---

## 9. 既存コードとの整合ポイント

| 既存パターン | Ghost実装方針 |
|------------|-------------|
| `shared/claude-client.js` | そのまま使用（Sonnetモデル指定） |
| `shared/queue.js` | `ghost/queue/ideas.jsonl` で同パターン |
| `shared/logger.js` | 全箇所でimport |
| `shared/daily-limit.js` | Ghost用は不要（週1-2回のみ） |
| note/generate.jsの2段生成 | 参考にする（outline → body） |
| analytics/buzz-analyzerと連携 | 英語版`prompt-hints`を別ファイルで管理 |

---

## 10. 優先実装順

```
1. ghost/post.js          ← API接続確認が最優先
2. ghost/generate.js      ← Claude Sonnet英語生成
3. ghost/translate.js     ← note記事の英語化（リパーパス）
4. scheduler統合          ← 週次自動実行
5. ghost/newsletter.js    ← メール配信（Phase 2以降）
```

---

**参考リポジトリ/ドキュメント:**
- Ghost Admin API: https://ghost.org/docs/admin-api/
- @tryghost/admin-api: https://www.npmjs.com/package/@tryghost/admin-api
- Ghost self-hosting: https://ghost.org/docs/install/
- Ghost Docker: https://hub.docker.com/_/ghost
