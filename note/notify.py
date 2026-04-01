#!/usr/bin/env python3
"""
note ワンクリック公開ヘルパー

使い方:
  python3 note/notify.py          # 公開待ち下書きを通知
  python3 note/notify.py --open   # ブラウザで全下書きを開く
  python3 note/notify.py --list   # 状態一覧を表示

フロー:
  JS scheduler → note:post（下書き保存）→ このスクリプトで通知
  → クリックでブラウザが開く → note.comで「公開」を押すだけ
"""

import json
import os
import subprocess
import sys
import webbrowser
from pathlib import Path
from datetime import datetime

DRAFTS_DIR = Path(__file__).parent / "drafts"


def load_drafts() -> list[dict]:
    if not DRAFTS_DIR.exists():
        return []
    drafts = []
    for f in sorted(DRAFTS_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text())
            data["_file"] = str(f)
            drafts.append(data)
        except (json.JSONDecodeError, OSError):
            pass
    return drafts


def pending_publish(drafts: list[dict]) -> list[dict]:
    """note.comに下書き保存済み、かつ未公開のもの (status=posted, promoPosted=false)"""
    return [d for d in drafts if d.get("status") == "posted" and not d.get("promoPosted", True)]


def local_drafts(drafts: list[dict]) -> list[dict]:
    """ローカル下書きのみ (note.comにまだ保存されていない)"""
    return [d for d in drafts if d.get("status") == "draft"]


def notify(title: str, body: str, url: str | None = None) -> None:
    """デスクトップ通知を送る。URLがあればアクション付き。"""
    args = ["notify-send", "--urgency=normal", "--expire-time=30000"]
    if url:
        args += ["--action=open:ブラウザで開く"]
    args += [title, body]

    result = subprocess.run(args, capture_output=True, text=True)

    # --action をクリックした場合、notify-send が "open" を stdout に返す
    if url and result.stdout.strip() == "open":
        webbrowser.open(url)


def notify_all_pending(pending: list[dict]) -> None:
    if not pending:
        print("公開待ちの下書きはありません。")
        return

    for draft in pending:
        url = draft.get("noteUrl", "")
        title = draft.get("title", "（タイトルなし）")
        posted_at = draft.get("postedAt", "")
        if posted_at:
            dt = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
            date_str = dt.strftime("%m/%d %H:%M")
        else:
            date_str = ""

        body = f"下書き保存済み {date_str}\n「公開」ボタンを押すだけで完了"
        print(f"通知: {title}")
        print(f"  URL: {url or '（URLなし）'}")
        notify(f"note 公開待ち: {title[:30]}", body, url or None)


def open_all(pending: list[dict]) -> None:
    if not pending:
        print("公開待ちの下書きはありません。")
        return
    for draft in pending:
        url = draft.get("noteUrl")
        if url:
            print(f"開く: {url}")
            webbrowser.open(url)
        else:
            print(f"URLなし (JS note:post をまず実行してください): {draft.get('title')}")


def list_all(drafts: list[dict]) -> None:
    if not drafts:
        print("下書きが見つかりません。")
        return

    status_label = {
        "draft":    "📝 ローカル下書き",
        "posted":   "⏳ note.com下書き保存済み（公開待ち）",
        "published":"✅ 公開済み",
    }

    for d in drafts:
        status = d.get("status", "unknown")
        promo = "（X告知済み）" if d.get("promoPosted") else ""
        label = status_label.get(status, status)
        print(f"{label}{promo}")
        print(f"  タイトル : {d.get('title', '—')}")
        if d.get("noteUrl"):
            print(f"  URL      : {d['noteUrl']}")
        print()


def main() -> None:
    args = sys.argv[1:]
    drafts = load_drafts()
    pending = pending_publish(drafts)

    if "--list" in args:
        list_all(drafts)
    elif "--open" in args:
        open_all(pending)
    else:
        # デフォルト: デスクトップ通知
        notify_all_pending(pending)

        # フォールバック: notifyが--actionに対応していない場合はそのままブラウザを開く
        if pending and "--no-open" not in args:
            answer = input(f"\n{len(pending)}件の下書きをブラウザで開きますか？ [Y/n]: ").strip().lower()
            if answer in ("", "y", "yes"):
                open_all(pending)


if __name__ == "__main__":
    main()
