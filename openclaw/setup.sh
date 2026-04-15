#!/bin/bash
# OpenClaw セットアップスクリプト
set -e

echo "=== OpenClaw セットアップ ==="

# バージョン確認
openclaw --version || { echo "openclaw not found. Run: npm install -g openclaw@latest"; exit 1; }

# 設定ディレクトリ作成
mkdir -p ~/.openclaw/agents/default

# SOUL.md をコピー
cp "$(dirname "$0")/SOUL.md" ~/.openclaw/agents/default/SOUL.md
echo "✅ SOUL.md → ~/.openclaw/agents/default/SOUL.md"

# config.json 生成（未作成の場合のみ）
CONFIG="$HOME/.openclaw/openclaw.json"
if [ ! -f "$CONFIG" ]; then
  cp "$(dirname "$0")/config.json.example" "$CONFIG"
  echo "✅ config.json.example → ~/.openclaw/openclaw.json"
  echo ""
  echo "⚠️  ~/.openclaw/openclaw.json の以下を設定してください："
  echo "   - channels.telegram.botToken: Telegramボットトークン"
  echo "   - agent.soulFile: (既に設定済み)"
else
  echo "ℹ️  ~/.openclaw/openclaw.json は既に存在します（スキップ）"
fi

echo ""
echo "=== 起動方法 ==="
echo "openclaw gateway &   # バックグラウンドで起動"
echo "openclaw tui         # TUI（ターミナルUI）で確認"
echo ""
echo "Telegram Bot作成手順:"
echo "  1. Telegram で @BotFather に /newbot"
echo "  2. ボットトークンをコピー"
echo "  3. ~/.openclaw/openclaw.json の botToken に貼り付け"
echo "  4. openclaw channels login で接続"
