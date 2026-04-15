#!/bin/bash
# SNS自動化基盤 起動スクリプト
# Bridge Server (port 3001) + n8n (port 5678) を同時起動する

set -e
cd "$(dirname "$0")"

# ── 依存チェック ─────────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "[setup] node_modules not found — running npm install..."
  npm install
fi

if [ ! -d "node_modules/concurrently" ]; then
  echo "[setup] installing concurrently..."
  npm install --save-dev concurrently
fi

# ── n8n データディレクトリ作成 ────────────────────────────────────────
mkdir -p n8n/data

# ── .env チェック ────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "[warn] .env not found. Copy .env.example and fill in your credentials."
  echo "       cp .env.example .env"
  exit 1
fi

echo ""
echo "  Bridge Server → http://localhost:3001"
echo "  n8n UI        → http://localhost:5678"
echo "  OpenClaw      → http://localhost:8080 (オプション)"
echo ""
echo "  起動後、n8n UI を開いてワークフローをインポートしてください。"
echo "  import: n8n/workflows/*.json"
echo ""

# ── claude-mem ワーカー（セッション記憶） ───────────────────────────────
if command -v npx &>/dev/null; then
  echo "  claude-mem ワーカーを起動します... (port 37777)"
  npx claude-mem start &>/dev/null &
fi

# ── OpenClaw（オプション） ─────────────────────────────────────────────
if command -v openclaw &>/dev/null && [ -f "$HOME/.openclaw/openclaw.json" ]; then
  echo "  OpenClaw を起動します..."
  openclaw gateway &
  OPENCLAW_PID=$!
  trap "kill $OPENCLAW_PID 2>/dev/null" EXIT
else
  echo "  [skip] OpenClaw: 未設定 (openclaw/setup.sh を実行してください)"
fi

echo ""
npm run start
