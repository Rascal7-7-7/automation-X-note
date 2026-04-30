#!/usr/bin/env bash
# Bridge tunnel startup: cloudflared quick tunnel → kv_store に BRIDGE_URL を即時保存
# vercel deploy 不要 — ダッシュボードが kv_store から URL を読み取る
set -euo pipefail

NODE="/Users/Rascal/.nvm/versions/node/v24.14.1/bin/node"
LOG=/tmp/cloudflared.log
PID_FILE=/tmp/cloudflared-bridge.pid
DASHBOARD_DIR="/Users/Rascal/work/automation/dashboard-v2"

# 既存プロセス停止
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  kill "$OLD_PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# Bridge Server が起動するまで最大60秒待つ
echo "[bridge-tunnel] waiting for bridge server..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    echo "[bridge-tunnel] bridge server up"
    break
  fi
  sleep 1
done

if ! curl -sf http://localhost:3001/health > /dev/null 2>&1; then
  echo "[bridge-tunnel] ERROR: bridge server not responding on :3001" >&2
  exit 1
fi

# トンネル起動（http2固定 — QUICは接続不安定）
> "$LOG"
/opt/homebrew/bin/cloudflared tunnel \
  --url http://localhost:3001 \
  --no-autoupdate \
  --protocol http2 \
  >> "$LOG" 2>&1 &
TUNNEL_PID=$!
echo "$TUNNEL_PID" > "$PID_FILE"
# detach from this script's process group so launchd doesn't SIGTERM it on exit
disown $TUNNEL_PID

# URL取得（最大30秒待つ）
BRIDGE_URL=""
for i in $(seq 1 30); do
  BRIDGE_URL=$(grep -ao "https://[a-z0-9-]*\.trycloudflare\.com" "$LOG" 2>/dev/null | head -1) || true
  [[ -n "$BRIDGE_URL" ]] && break
  sleep 1
done

if [[ -z "$BRIDGE_URL" ]]; then
  echo "[bridge-tunnel] ERROR: could not get tunnel URL after 30s" >&2
  cat "$LOG" >&2
  exit 1
fi

echo "[bridge-tunnel] URL: $BRIDGE_URL"

# 疎通確認
if ! curl -sf --max-time 10 "$BRIDGE_URL/health" > /dev/null 2>&1; then
  echo "[bridge-tunnel] WARN: tunnel not yet reachable, waiting 10s..."
  sleep 10
fi

# kv_store に保存（vercel deploy 不要 — 秒単位で反映）
cd "$DASHBOARD_DIR"
"$NODE" --env-file=".env.local" scripts/save-bridge-url.mjs "$BRIDGE_URL"

echo "[bridge-tunnel] done. PID=$TUNNEL_PID URL=$BRIDGE_URL"
