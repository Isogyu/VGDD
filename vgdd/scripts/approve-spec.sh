#!/usr/bin/env bash
# VGDD Governance Kernel — 票の仕様をオーナーが承認する（Approval Gate。オーナーが sandbox の外で実行。p0.4.0、ADR-005・成立条件②）
#
# 票の仕様（統治の項目と受け入れ条件。spec-digest.mjs）を main から読んで表示し、オーナーが承認すると、
# その指紋を Z3 の evidence/spec_approvals.jsonl に記録する。gate-runner と night-runner は、承認の記録と指紋が
# 合わない票を統合・夜間の作業に回さない。仕様を起草するのは行政の長・立法補佐でよいが、効力はこの承認で生じる。
# 承認の記録は Z3 にあり、行政は書けない。仕様を1文字でも変えたら承認し直す。
#
# 使い方: vgdd/scripts/approve-spec.sh T-009 [--yes] [--note "メモ"]
set -euo pipefail
REPO="${VGDD_REPO:-$HOME/tsubuyaki-worklog/app}"; Z3="${VGDD_Z3_DIR:-$HOME/tsubuyaki-z3}"
HERE="$(cd "$(dirname "$0")" && pwd)"
GIT_BIN="$(type -P git)"
git() { "$GIT_BIN" -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand=ssh "$@"; }
task="${1:-}"; shift || true
[[ "$task" =~ ^T-[0-9]+$ ]] || { echo "使い方: approve-spec.sh T-NNN [--yes] [--note メモ]" >&2; exit 64; }
YES=0; NOTE=""
while [ $# -gt 0 ]; do
  case "$1" in --yes) YES=1; shift;; --note) NOTE="$2"; shift 2;; *) echo "不明な引数: $1" >&2; exit 64;; esac
done
[ -f "$Z3/STOP" ] && { echo "Kernel の停止中は承認しない（kernel-resume.sh で再開してから）" >&2; exit 70; }
[ "$(shasum -a 256 "$REPO/.git/config" | cut -c1-64)" = "$(cat "$Z3/evidence/git-config.baseline" 2>/dev/null)" ] || { echo ".git/config が基準値と違う（fail-closed）" >&2; exit 70; }

trel="$(git -C "$REPO" ls-tree --name-only main docs/tasks/ | grep "^docs/tasks/${task}-" | head -n 1 || true)"
[ -n "$trel" ] || { echo "票が main にない: ${task}（票は承認の前に main にコミットする）" >&2; exit 66; }
main_sha="$(git -C "$REPO" rev-parse main)"
node "$HERE/spec-digest.mjs" --repo "$REPO" --ref "$main_sha" --ticket "$trel" --show
digest="$(node "$HERE/spec-digest.mjs" --repo "$REPO" --ref "$main_sha" --ticket "$trel")"
pl="$(node "$HERE/spec-digest.mjs" --repo "$REPO" --ref "$main_sha" --ticket "$trel" --policy-line)"   # p0.4.4（INV-06）：承認を法律の系統に結び付ける
if [ "$YES" -ne 1 ]; then
  printf '\nこの仕様（main %s の %s）を承認しますか？ [y/N] ' "${main_sha:0:12}" "$trel"
  read -r ans; [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "承認しなかった"; exit 1; }
fi
ts="$(date +%Y-%m-%dT%H:%M:%S%z)"
jq -nc --arg ts "$ts" --arg t "$task" --arg f "$trel" --arg r "$main_sha" --arg d "$digest" --arg n "$NOTE" --arg pl "$pl" \
  '{schema:"vgdd.spec-approval.v1",ts:$ts,task:$t,ticket:$f,ref:$r,digest:$d,policy_line:$pl,approved_by:"owner",note:$n}' >> "$Z3/evidence/spec_approvals.jsonl"
printf '{"ts":"%s","type":"spec_approved","task":"%s","digest":"%s","ref":"%s"}\n' "$ts" "$task" "$digest" "${main_sha:0:12}" >> "$Z3/evidence/gate_events.jsonl"
echo "承認を記録した: ${task} ${digest}"
