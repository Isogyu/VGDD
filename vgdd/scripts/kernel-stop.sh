#!/usr/bin/env bash
# VGDD Governance Kernel — 全体の停止（封じ込め。オーナーが sandbox の外で実行。p0.4.0、ADR-027・ADR-010）
#
# Z3 に STOP を置く。置いている間は：
#   ・policy.mjs（フック）が、すべてのエージェントの読み取りのツール（Read・Glob・Grep）以外の操作を拒否する（Bash はすべて拒否）
#   ・gate-runner は申請を処理しない（周回の始め、申請ごと、held の記録と統合の直前に確かめる）。night-runner は新しい票を取らない。
#     release.sh（票ごと）・approve-spec.sh は動かない
# 止まらないもの（既知の限界）：停止の前に始まって実行中の Bash、夜間の作業員（headless の claude）、司法の呼び出し。
#   それらは新しいツール呼び出しの時点でフックに止められるが、実行中のプロセスを強制終了はしない。
# STOP は Z3 にあるので、エージェントは作れず、消せない。再開は kernel-resume.sh（安全性を確かめてから）。
#
# STOP の中身：1行目＝理由（フックが拒否の理由に使う）、2行目＝stop_id、3行目＝停止の時点の main の完全な SHA。
#   再開は STOP そのものに書いた SHA から後のコミットを数える（出来事の記録の追記に失敗しても、停止の情報は失われない）。
#
# 使い方: vgdd/scripts/kernel-stop.sh "理由（例：作業員の不審な操作を調べる）"
set -euo pipefail
REPO="${VGDD_REPO:-$HOME/tsubuyaki-worklog/app}"; Z3="${VGDD_Z3_DIR:-$HOME/tsubuyaki-z3}"
GIT_BIN="$(type -P git)"
reason="${1:-}"; [ -n "$reason" ] || { echo "使い方: kernel-stop.sh \"理由\"" >&2; exit 64; }
# 停止と再開を直列化する錠（mkdir は原子的）
LOCK="$Z3/.kernel.lock"
mkdir "$LOCK" 2>/dev/null || { echo "別の停止・再開が動いている（${LOCK}）。終わってからやり直す" >&2; exit 75; }
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
[ -f "$Z3/STOP" ] && { echo "すでに停止中: $(head -n 1 "$Z3/STOP")"; exit 0; }
ts="$(date +%Y-%m-%dT%H:%M:%S%z)"; stop_id="stop-$(date +%Y%m%d-%H%M%S)-$$"
# 停止の時点の main（再開の前に、ここから後のコミットを数える。日付は偽れるので SHA で見る）。読めなければ unknown（再開は確かめられないので拒む）
main_sha="$("$GIT_BIN" -c core.hooksPath=/dev/null -c core.fsmonitor=false -C "$REPO" rev-parse main 2>/dev/null || echo unknown)"
# 停止を先に効かせる（STOP を置く）。記録はその後
printf '%s（%s）\nstop_id=%s\nmain=%s\n' "$reason" "$ts" "$stop_id" "$main_sha" > "$Z3/STOP"
jq -nc --arg ts "$ts" --arg r "$reason" --arg m "$main_sha" --arg id "$stop_id" '{ts:$ts,type:"kernel_stop",task:"-",stop_id:$id,reason:$r,main:$m,by:"owner"}' >> "$Z3/evidence/gate_events.jsonl" \
  || echo "警告：停止の記録を書けなかった（停止そのものは効いている）" >&2
echo "Kernel を停止した：${reason}（${stop_id}）。再開は kernel-resume.sh"
