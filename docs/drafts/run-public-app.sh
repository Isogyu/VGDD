#!/usr/bin/env bash
# 公開のアプリ（Next.js、読むだけ）を、main の checkout を汚さずに http://localhost:3000 に出す。
# 手順と理由は docs/drafts/run-public-app.md。使い方：
#   bash docs/drafts/run-public-app.sh          # 起動（Ctrl+C で止まる）
#   bash docs/drafts/run-public-app.sh --clean  # 一時の作業ツリーを片付ける
# 環境変数：PUBLIC_APP_DIR（一時の作業ツリーの場所。既定 $TMPDIR/tsubuyaki-public-app）、PUBLIC_APP_PORT（既定 3000）
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
WT="${PUBLIC_APP_DIR:-${TMPDIR:-/tmp}/tsubuyaki-public-app}"
PORT="${PUBLIC_APP_PORT:-3000}"
INTERVAL=15

if [ "${1:-}" = "--clean" ]; then
  if [ -d "$WT" ]; then git -C "$REPO" worktree remove --force "$WT"; fi
  git -C "$REPO" worktree prune
  echo "片付けた：${WT}"
  exit 0
fi

# 1. 一時の作業ツリー（main の今のコミット。ブランチを作らない）
if [ -d "$WT/.git" ] || [ -f "$WT/.git" ]; then
  git -C "$WT" checkout --quiet --detach main
else
  git -C "$REPO" worktree add --quiet --detach "$WT" main
fi
echo "作業ツリー：${WT}（$(git -C "$WT" rev-parse --short HEAD)）"

# 2. 依存（package-lock.json が変わったときだけ入れ直す）
LOCKSUM="$(shasum -a 256 "$WT/package-lock.json" | cut -d' ' -f1)"
if [ ! -d "$WT/node_modules" ] || [ "$(cat "$WT/node_modules/.lock-sum" 2>/dev/null)" != "$LOCKSUM" ]; then
  (cd "$WT" && npm ci --no-audit --no-fund --cache "${TMPDIR:-/tmp}/npm-cache")
  echo "$LOCKSUM" > "$WT/node_modules/.lock-sum"
fi

# 3. 稼働中の写しを、main の checkout から一時の作業ツリーへ写し続ける
#    （裁判所が main の checkout に書く。記号リンクは読み込み側が拒むので、写す。
#      一時の名前に写してから mv で置き換え、書きかけを読ませない）
sync_copies() {
  local f
  for f in kernel-state.json kernel-invariants.json; do
    if [ -f "$REPO/docs/governance/$f" ] && [ ! -L "$REPO/docs/governance/$f" ]; then
      cp "$REPO/docs/governance/$f" "$WT/docs/governance/$f.sync-tmp" && mv -f "$WT/docs/governance/$f.sync-tmp" "$WT/docs/governance/$f"
    else
      rm -f "$WT/docs/governance/$f"
    fi
  done
}
sync_copies
( while sleep "$INTERVAL"; do sync_copies; done ) &
SYNC_PID=$!
trap 'kill "$SYNC_PID" 2>/dev/null || true' EXIT INT TERM

# 4. 公開のアプリ。DB は main の checkout の data/（git で無視されるファイル）を使い、デモの合成データを共有する
mkdir -p "$REPO/data"
cd "$WT"
echo "公開のアプリ：http://localhost:${PORT}/governance（写しは ${INTERVAL} 秒ごとに更新。Ctrl+C で止まる）"
TSUBUYAKI_DB_PATH="$REPO/data/tsubuyaki.db" \
VGDD_REQUIREMENTS_DB_PATH="$REPO/data/vgdd-requirements.db" \
NEXT_TELEMETRY_DISABLED=1 \
  ./node_modules/.bin/next dev -p "$PORT"
