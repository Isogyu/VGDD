#!/bin/bash
# VGDD Governance Kernel — AI の呼び出しを予算の台帳に通す窓口（法律 p0.5.0、SPEC §9）
#
# 使い方: metered.sh <kind> <task|-> <tokens|auto> <claude|none> -- <コマンド> [引数...]
#   起動の前に ledger.mjs begin で予約し、拒まれたら起動せずに終了 75（理由の符号を標準エラーに1行）。
#   起動したら pid を started で残し、終わったら finish で精算する（利用量が読めなければ予約の全量で数える）。
#   標準入力はそのままコマンドに渡し、コマンドの標準出力は終わった後にそのまま出す。終了コードはコマンドのもの。
#   要求の ID は環境変数 VGDD_REQ_ID（なければ毎回新しく作る）。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
LEDGER="$HERE/ledger.mjs"
[ $# -ge 6 ] && [ "$5" = "--" ] || { echo "bad_args" >&2; exit 64; }
KIND="$1"; TASK="$2"; TOKENS="$3"; FORMAT="$4"; shift 5
REQ="${VGDD_REQ_ID:-${KIND}-${TASK}-$(date +%s)-$$-${RANDOM}}"
RUN="$(node "$LEDGER" begin --kind "$KIND" --task "$TASK" --req "$REQ" --tokens "$TOKENS")" || exit 75
OUT="$(mktemp "${TMPDIR:-/tmp}/vgdd-metered.XXXXXX")"
trap 'rm -f "$OUT"' EXIT
exec 3<&0
"$@" <&3 > "$OUT" &
PID=$!
node "$LEDGER" started --run "$RUN" --pid "$PID" >/dev/null 2>&1 || true
RC=0; wait "$PID" || RC=$?
node "$LEDGER" finish --run "$RUN" --code "$RC" --usage-file "$OUT" --format "$FORMAT" >/dev/null 2>&1 || true
cat "$OUT"
exit "$RC"
