#!/bin/bash
# VGDD Governance Kernel — 作業員の起動の窓口（法律 p0.4.10、SPEC §5-4。D-66・D-67）
#
# 行政の長が置いた起動の申請（merge-requests/launch/T-NNN.json、中身は {"task":"T-NNN"} だけ）を launch-intake.mjs で確かめて Z3 に取り込み、
# 夜間の代行（night-runner.sh --launch T-NNN）を1票ずつ起動する。承認・依存・停止・予算（台帳）・同時の数・前検査・自動修正は night-runner が行う。
# 置き場所：原本は vgdd/scripts/launcher.sh。実行用は ~/tsubuyaki-z3/bin/launcher.sh（オーナーがコピー）。sandbox の外でオーナーが起動する（gate-runner と並べて）。
#
# 使い方: launcher.sh [--repo ~/tsubuyaki-worklog/app] [--interval 30] [--once] [--dry-run]
#
# 守ること：
#   - 1つだけ動く（Z3/launch/.lock。持ち主の pid が生きていれば2つ目は止まる）
#   - 申請の正本は Z3 の状態（launch/state.jsonl）。受け取った → 起動した（pid）→ 終わった。受け取ったまま起動の記録がない票は、次の周回で起動する（障害の後の再開）
#   - 動いているかは、状態の pid（プロセス群）の生死で見る（プロセスの名前で探さない）
#   - Kernel の停止中は、受け取りも起動もしない
set -euo pipefail
REPO="${HOME}/tsubuyaki-worklog/app"; INTERVAL=30; ONCE=0; DRY=0
Z3="${VGDD_Z3_DIR:-${HOME}/tsubuyaki-z3}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;; --interval) INTERVAL="$2"; shift 2;; --once) ONCE=1; shift;; --dry-run) DRY=1; shift;;
    *) echo "不明な引数: $1" >&2; exit 64;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
QDIR="$Z3/launch"; mkdir -p "$QDIR"
INTAKE=(node "$HERE/launch-intake.mjs" --repo "$REPO" --z3 "$Z3")
log() { echo "[$(date +%H:%M:%S)] $*"; }
# ---- 1つだけ動く --------------------------------------------------------------------------------------
LOCK="$QDIR/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  owner="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ "$owner" =~ ^[0-9]+$ ]] && kill -0 "$owner" 2>/dev/null; then echo "launcher はもう動いている（pid ${owner}）" >&2; exit 75; fi
  rm -rf "$LOCK"; mkdir "$LOCK"   # 持ち主のいないロック（前の launcher が落ちた）
fi
echo "$$" > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT
cycle() {
  "${INTAKE[@]}" --sweep
  "${INTAKE[@]}" >/dev/null || true          # 新しい申請を確かめて受け取る（受け取った票は state.jsonl に received）
  local task extra=()
  [ "$DRY" -eq 1 ] && extra+=(--dry-run)
  for task in $("${INTAKE[@]}" --pending); do
    [[ "$task" =~ ^T-[0-9]{3,4}$ ]] || continue
    printf '{"tickets":["%s"],"limits":{"until":"23:59","max_tickets":1,"parallel":1}}\n' "$task" > "$QDIR/queue-${task}.json"
    log "${task}: night-runner --launch を起動"
    # 端末を持たない新しいセッションで動かす（p0.4.9a と同じ理由。プロセス群の ID は pid と同じ）
    nohup perl -MPOSIX -e 'my $s = POSIX::setsid(); defined($s) && $s > 0 or exit 126; exec @ARGV or exit 127' "$HERE/night-runner.sh" --queue "$QDIR/queue-${task}.json" --repo "$REPO" --launch "$task" ${extra[@]+"${extra[@]}"} < /dev/null >> "$QDIR/${task}.log" 2>&1 &
    local pid=$!
    "${INTAKE[@]}" --started "$task" --pid "$pid"
  done
}
log "launcher 起動: repo=$REPO interval=${INTERVAL}s"
while :; do
  if [ -f "$Z3/STOP" ]; then log "Kernel の停止中。申請を処理しない"; else cycle; fi
  if [ "$ONCE" -eq 1 ]; then wait 2>/dev/null || true; "${INTAKE[@]}" --sweep; break; fi
  sleep "$INTERVAL"
done
