#!/bin/bash
# X MCP サーバー起動スクリプト
# automation/.env の X API 認証情報を MCP サーバーに渡す

ENV_FILE="/home/rascal/work/automation/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE" >&2
  exit 1
fi

# .env を読み込む（export付き）
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# @enescinar/twitter-mcp が期待する変数名にマッピング
export API_KEY="$X_API_KEY"
export API_SECRET_KEY="$X_API_SECRET"
export ACCESS_TOKEN="$X_ACCESS_TOKEN"
export ACCESS_TOKEN_SECRET="$X_ACCESS_TOKEN_SECRET"

# 認証情報チェック
if [ -z "$API_KEY" ] || [ -z "$ACCESS_TOKEN" ]; then
  echo "ERROR: X API credentials not set in .env" >&2
  echo "  Required: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET" >&2
  exit 1
fi

# 注意: search_tweets は有料API（402）のため使用禁止
# post_tweet は xurl CLI で代替しているため実質未使用
exec npx -y @enescinar/twitter-mcp
