#!/bin/zsh
# automation 開発用 Zellij セットアップ
# 使い方: zellij new-session --name automation-dev -- zsh -c "source scripts/zellij-setup.sh"

cd /Users/Rascal/work/automation

# ペイン1 (左70%): 開発作業エリア
zellij action new-pane --direction right -- zsh -c "pm2 logs sns-scheduler --lines 50; zsh"

# ペイン2 (右上): PM2ログ監視
zellij action move-focus right
zellij action new-pane --direction down -- zsh -c "cd /Users/Rascal/work/automation && watch -n 30 'tail -5 logs/$(date +%Y-%m-%d).log 2>/dev/null'; zsh"

# 左ペインに戻す
zellij action move-focus left
echo "✅ automation-dev Zellij セットアップ完了"
echo "左: 開発作業 | 右上: PM2ログ | 右下: 監視"
