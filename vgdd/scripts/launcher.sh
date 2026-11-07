#!/bin/bash
# VGDD Governance Kernel — 作業員の起動の窓口（法律 p0.4.10、SPEC §5-4。D-66・D-67）
#
# 行政の長が置いた起動の申請（merge-requests/launch/T-NNN.json、中身は {"task":"T-NNN"} だけ）を読み、
# 夜間の代行（night-runner.sh --launch T-NNN）を1票ずつ起動する。承認・依存・停止・予算（台帳）・同時の数・前検査・自動修正は night-runner が行う。
# 置き場所：原本は vgdd/scripts/launcher.sh。実行用は ~/tsubuyaki-z3/bin/launcher.sh（オーナーがコピー）。sandbox の外でオーナーが起動する（gate-runner と並べて）。
#
# 使い方: launcher.sh [--repo ~/tsubuyaki-worklog/app] [--interval 30] [--once] [--dry-run]
#   --dry-run  night-runner も --dry-run で起動し、作業員は起動しない
#
# 申請の扱い（開発の側が触れる場所なので、信じずに確かめる）:
#   - 通常のファイル（記号リンクでない）・256 バイトまで・名前が T-NNN.json・中身がちょうど {"task": 名前と同じ ID} のときだけ受け付ける
#   - 受け付けたら merge-requests/launch/done/ に移してから起動する（同じ申請で二度起動しない）。合わない申請は理由を付けて done に移す
#   - 同じ票の night-runner が動いていれば、申請は置いたままにして次の周回で見る
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
REQ_DIR="$REPO/merge-requests/launch"; DONE_DIR="$REQ_DIR/done"; QDIR="$Z3/launch"
mkdir -p "$REQ_DIR" "$DONE_DIR" "$QDIR"
ts() { date +%Y-%m-%dT%H:%M:%S%z; }
log() { echo "[$(date +%H:%M:%S)] $*"; }
finish_req() { # file, verdict, reason
  local base; base="$(basename "$1")"
  jq -n --arg file "$base" --arg verdict "$2" --arg reason "$3" --arg at "$(ts)" '{file:$file, verdict:$verdict, reason:$reason, at:$at}' > "$DONE_DIR/${base%.json}.$(date +%s).$2.json"
  rm -f "$1"
}
cycle() {
  local f name task size
  for f in "$REQ_DIR"/*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    [ -d "$f" ] && [ ! -L "$f" ] && continue   # done/ などのフォルダは飛ばす
    name="$(basename "$f")"
    if [ -L "$f" ] || [ ! -f "$f" ]; then log "申請 ${name}: 通常のファイルではない"; finish_req "$f" rejected "通常のファイルではない"; continue; fi
    if ! [[ "$name" =~ ^T-[0-9]{3,4}\.json$ ]]; then log "申請 ${name}: 名前の形が違う"; finish_req "$f" rejected "名前の形が違う"; continue; fi
    task="${name%.json}"
    size="$(wc -c < "$f" | tr -d ' ')"
    if [ "$size" -gt 256 ]; then finish_req "$f" rejected "大きすぎる"; continue; fi
    if ! jq -e --arg t "$task" 'type=="object" and (keys==["task"]) and .task==$t' "$f" >/dev/null 2>&1; then finish_req "$f" rejected "中身の形が違う（{\"task\":\"${task}\"} だけ）"; continue; fi
    if pgrep -f "night-runner.sh .*--launch ${task}( |$)" >/dev/null 2>&1; then log "申請 ${task}: 同じ票の作業がまだ動いている。次の周回で見る"; continue; fi
    finish_req "$f" accepted "night-runner --launch に渡した"
    printf '{"tickets":["%s"],"limits":{"until":"23:59","max_tickets":1,"parallel":1}}\n' "$task" > "$QDIR/queue-${task}.json"
    local extra=(); [ "$DRY" -eq 1 ] && extra+=(--dry-run)
    log "申請 ${task}: night-runner --launch を起動"
    nohup "$HERE/night-runner.sh" --queue "$QDIR/queue-${task}.json" --repo "$REPO" --launch "$task" ${extra[@]+"${extra[@]}"} >> "$QDIR/${task}.log" 2>&1 &
  done
}
log "launcher 起動: repo=$REPO interval=${INTERVAL}s"
while :; do
  if [ -f "$Z3/STOP" ]; then log "Kernel の停止中。申請を処理しない"; else cycle; fi
  [ "$ONCE" -eq 1 ] && { wait 2>/dev/null || true; break; }
  sleep "$INTERVAL"
done
