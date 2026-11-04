#!/usr/bin/env bash
# VGDD Phase 1 — 監査（作業員の書いたコード）を macOS の sandbox-exec の中で実行する（p0.3.0、OBS-023①）。
# 使い方: sandboxed-run.sh --dir <一時 worktree> [--net] -- <コマンド...>
#   書き込み：--dir と一時領域（npm のキャッシュを含む）だけ。Z3・~/.claude・main の checkout・vgdd・.env.local は書けない。
#   読み取り：Z3、main の .env.local、~/.ssh は読めない。
#   ネットワーク：既定で禁止。--net のとき（npm ci）だけ許可。
set -euo pipefail
DIR=""; NET=0
while [ $# -gt 0 ]; do case "$1" in --dir) DIR="$2"; shift 2;; --net) NET=1; shift;; --) shift; break;; *) echo "不明な引数: $1" >&2; exit 64;; esac; done
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "--dir が必要" >&2; exit 64; }
command -v sandbox-exec >/dev/null || { echo "sandbox-exec がない（fail-closed）" >&2; exit 69; }
real() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
D="$(real "$DIR")"; T="$(real "${TMPDIR:-/tmp}")"; Z3="$(real "${VGDD_Z3_DIR:-$HOME/tsubuyaki-z3}")"
REPO="$(real "${VGDD_REPO:-$HOME/tsubuyaki-worklog/app}")"
export npm_config_cache="$T/vgdd-npm-cache"; mkdir -p "$npm_config_cache"
PROFILE="(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath \"$D\") (subpath \"$T\") (subpath \"/private/var/folders\") (subpath \"/dev\"))
(deny file-read* (subpath \"$Z3\") (literal \"$REPO/.env.local\") (subpath \"$HOME/.ssh\"))
$( [ "$NET" -eq 1 ] || echo '(deny network-outbound (remote ip))' )"
exec sandbox-exec -p "$PROFILE" "$@"
