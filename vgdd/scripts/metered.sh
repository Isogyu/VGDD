#!/bin/bash
# VGDD Governance Kernel — AI の呼び出しを予算の台帳に通す窓口（法律 p0.4.9、SPEC §9）
#
# 使い方: metered.sh <kind> <task|-> <tokens|auto> <claude|none> -- <コマンド> [引数...]
#   起動の前に ledger.mjs begin で予約し、拒まれたら起動せずに終了 75（理由の符号を標準エラーに1行）。
#   コマンドは自分のプロセス群で動かし、pid を started で残す。窓口が TERM・INT・HUP・ALRM を受けたら（夜間の時間切れなど）、
#   プロセス群ごと終わらせ、終わりを確かめてから精算する。終わりを確かめられなければ精算せず（予約と枠を保つ）終了 75。
#   起動の記録・精算に失敗したら、出力を渡さずに終了 75（呼び出した側は「使えない」として扱う。合格にしない）。
#   標準入力はそのままコマンドに渡し、コマンドの標準出力は精算の後にそのまま出す。終了コードはコマンドのもの。
#   要求の ID は環境変数 VGDD_REQ_ID（なければ毎回新しく作る）。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
LEDGER="$HERE/ledger.mjs"
[ $# -ge 6 ] && [ "$5" = "--" ] || { echo "bad_args" >&2; exit 64; }
KIND="$1"; TASK="$2"; TOKENS="$3"; FORMAT="$4"; shift 5
REQ="${VGDD_REQ_ID:-${KIND}-${TASK}-$(date +%s)-$$-${RANDOM}}"
RUN="$(node "$LEDGER" begin --kind "$KIND" --task "$TASK" --req "$REQ" --tokens "$TOKENS")" || exit 75
OUT="$(mktemp "${TMPDIR:-/tmp}/vgdd-metered.XXXXXX")"
PID=""
cleanup() { rm -f "$OUT"; }
trap cleanup EXIT
stop_child() {
  # bash は trap を「今のコマンドが終わった後」に動かす。子の起動（& の行）の途中で受けた中断は、& の後に動くので $! が子を指す。
  # PID の代入の前でも $! で子を拾う（起動の前なら $! は空。Codex の3回目の監査 ①）
  # bash 3.2 は set -u のもとで、未設定の $! を ${!:-} でも未定義として止まるので、読む間だけ nounset を外す（Codex の4回目の監査）
  if [ -z "$PID" ]; then set +u; PID="$!"; set -u; fi
  if [ -z "$PID" ]; then   # まだ起動していない：予約を取り消して終わる
    node "$LEDGER" cancel --run "$RUN" >/dev/null 2>&1 || true
    echo "interrupted" >&2; exit 75
  fi
  kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$PID" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$PID" 2>/dev/null || true
  sleep 0.2
  if kill -0 -- "-$PID" 2>/dev/null; then echo "child_alive" >&2; exit 75; fi   # 終わりを確かめられない：精算しない
  wait "$PID" 2>/dev/null
  node "$LEDGER" finish --run "$RUN" --code 143 --usage-file "$OUT" --format "$FORMAT" >/dev/null 2>&1 || { echo "finish_failed" >&2; exit 75; }
  echo "interrupted" >&2; exit 75
}
# trap は子を起動する前に置く（起動の直前・直後の中断でも子を残さない。Codex の再監査 ①）
trap stop_child TERM INT HUP ALRM
# 子を自分のプロセス群で動かす（job control を有効にすると、バックグラウンドの子は新しいプロセス群の長になる）
set -m
exec 3<&0
"$@" <&3 > "$OUT" &
PID=$!
set +m
if ! node "$LEDGER" started --run "$RUN" --pid "$PID" >/dev/null 2>&1; then
  echo "started_failed" >&2; stop_child
fi
RC=0; wait "$PID" || RC=$?
# wait がシグナルで戻ったときは trap の中で終わる。ここは子が終わった後
# 子が終わっても、同じプロセス群の孫が残っていれば終わらせてから精算する（子孫の終わりを確かめる）
if kill -0 -- "-$PID" 2>/dev/null; then stop_child; fi
node "$LEDGER" finish --run "$RUN" --code "$RC" --usage-file "$OUT" --format "$FORMAT" >/dev/null 2>&1 || { echo "finish_failed" >&2; exit 75; }
cat "$OUT"
exit "$RC"
