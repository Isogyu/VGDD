#!/usr/bin/env bash
# VGDD — 夜間に判定へ合格した票を、朝にオーナーが確かめて統合する（オーナーが sandbox の外で実行。p0.3.1）。
# 夜間の gate-runner --hold は統合せず、合格した候補を Z3 の evidence/held.jsonl に記録する。
# この release.sh は、オーナーが画面と判定を確かめた票だけを、次の条件で main に統合する：
#   ・票は今の main と、申請の SHA から組み直す（--no-ff）。組み直した木が、夜に判定した候補の木と、記録（docs/tasks/）以外で一字一句同じ
#     ときだけ統合する。違えば止めて、昼に申請し直す（判定していないコードは入れない）
#   ・git はフックと fsmonitor を読まない。.git/config は基準値と照合する
# 使い方: vgdd/scripts/release.sh T-009 [T-010 ...]
set -euo pipefail
REPO="${VGDD_REPO:-$HOME/tsubuyaki-worklog/app}"; Z3="${VGDD_Z3_DIR:-$HOME/tsubuyaki-z3}"
git() { command git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand=ssh "$@"; }
[ "$(shasum -a 256 "$REPO/.git/config" | cut -c1-64)" = "$(cat "$Z3/evidence/git-config.baseline" 2>/dev/null)" ] || { echo ".git/config が基準値と違う（fail-closed）" >&2; exit 70; }
[ "$(git -C "$REPO" branch --show-current)" = "main" ] || { echo "main の checkout で実行する" >&2; exit 64; }
[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] || { echo "main に未コミットの変更がある" >&2; exit 64; }
for task in "$@"; do
  rec="$(jq -c --arg t "$task" 'select(.task==$t)' "$Z3/evidence/held.jsonl" | tail -n 1)"
  [ -n "$rec" ] || { echo "✗ ${task}：夜間の合格の記録がない" >&2; exit 1; }
  req="$(printf '%s' "$rec" | jq -r .request)"; cand="$(printf '%s' "$rec" | jq -r .candidate)"
  git -C "$REPO" cat-file -e "$cand^{commit}" || { echo "✗ ${task}：候補のコミットがない" >&2; exit 1; }
  before="$(git -C "$REPO" rev-parse HEAD)"
  git -C "$REPO" -c user.name=gate-runner -c user.email=gate-runner@local merge --no-ff -q -m "gate-runner: $task を統合（夜間の判定に合格、オーナーが朝に承認）" "$req" \
    || { git -C "$REPO" merge --abort || true; echo "✗ ${task}：今の main と衝突。昼に申請し直す" >&2; exit 1; }
  # 入った変更（記録の docs/tasks/ を除く）が、夜に判定した変更と一字一句同じか。複数の票を続けて承認しても、各票の変更そのものは変わらないことを確かめる
  mac="$(printf '%s' "$rec" | jq -r .main_at_check)"
  got="$(git -C "$REPO" diff --binary "$before" HEAD -- . ':(exclude)docs/tasks' | shasum -a 256 | cut -c1-64)"
  want="$(git -C "$REPO" diff --binary "$mac" "$cand" -- . ':(exclude)docs/tasks' | shasum -a 256 | cut -c1-64)"
  if [ "$got" != "$want" ]; then
    git -C "$REPO" reset -q --hard "$before"
    echo "✗ ${task}：入る変更が、夜に判定した変更と違う。統合を取り消した。昼に申請し直す" >&2; exit 1
  fi
  # 組み合わせた木で決定論的な監査を sandbox の中でもう一度（夜は別々に判定したため、組み合わせの不具合をここで止める）
  wt="$(mktemp -d "${TMPDIR:-/tmp}/release-$task-XXXX")"; git -C "$REPO" worktree add --detach -q "$wt" HEAD
  SBX="$Z3/bin/sandboxed-run.sh"
  if ! ( cd "$wt" && "$SBX" --dir "$wt" --net -- npm ci --no-fund --no-audit >/dev/null 2>&1 && "$SBX" --dir "$wt" -- npm run -s test >/dev/null 2>&1 \
        && "$SBX" --dir "$wt" -- npm run -s typecheck >/dev/null 2>&1 && "$SBX" --dir "$wt" -- npm run -s lint >/dev/null 2>&1 ); then
    git -C "$REPO" worktree remove --force "$wt" || true; git -C "$REPO" reset -q --hard "$before"
    echo "✗ ${task}：組み合わせた木で監査が不合格。統合を取り消した" >&2; exit 1
  fi
  git -C "$REPO" worktree remove --force "$wt" || true
  printf '{"ts":"%s","type":"merged","task":"%s","main":"%s","via":"release","candidate":"%s"}\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "$task" "$(git -C "$REPO" rev-parse --short=12 HEAD)" "${cand:0:12}" >> "$Z3/evidence/gate_events.jsonl"
  git -C "$REPO" update-ref -d "refs/vgdd/held/$task" || true
  echo "✓ $task を統合：$(git -C "$REPO" rev-parse --short=12 HEAD)"
done
