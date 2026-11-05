#!/usr/bin/env bash
# VGDD — 夜間に判定へ合格した票を、朝にオーナーが確かめて統合する（オーナーが sandbox の外で実行。p0.3.1、p0.4.1）。
# 夜間の gate-runner --hold は統合せず、合格した候補を Z3 の evidence/held.jsonl に記録する。
# この release.sh は、オーナーが画面と判定を確かめた票だけを、次の条件で main に統合する：
#   ・票は今の main と、申請の SHA から組み直す（--no-ff）。組み直した木が、夜に判定した候補の木と、記録（docs/tasks/）以外で一字一句同じ
#     ときだけ統合する。違えば止めて、昼に申請し直す（判定していないコードは入れない）
#   ・git はフックと fsmonitor を読まない。.git/config は基準値と照合する
# p0.4.1（OBS-048。V8 の朝にオーナーと立法補佐が同時に実行した）：
#   ・錠（Z3 の .release.lock）で、release.sh が同時に2つ動かないようにする。片方の取り消し（reset）がもう片方の統合を消さないため
#   ・申請の SHA がすでに main の祖先なら「統合済み」として何もしない（空の統合を「判定と違う」と誤って扱わない）
#   ・取り消し（reset）は、HEAD がこの実行の作った統合のコミットのときだけ行う
#   ・統合したら、票の status を merged にして §6 に1行を足し、その票だけを gate-runner の名でコミットする（_board.json は次の gate-runner の統合で作り直す）
# 使い方: vgdd/scripts/release.sh T-009 [T-010 ...]
set -euo pipefail
REPO="${VGDD_REPO:-$HOME/tsubuyaki-worklog/app}"; Z3="${VGDD_Z3_DIR:-$HOME/tsubuyaki-z3}"
GIT_BIN="$(type -P git)"
git() { "$GIT_BIN" -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand=ssh "$@"; }
LOCK="$Z3/.release.lock"
mkdir "$LOCK" 2>/dev/null || { echo "別の release.sh が動いている（${LOCK}）。終わってからやり直す" >&2; exit 75; }
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
[ "$(shasum -a 256 "$REPO/.git/config" | cut -c1-64)" = "$(cat "$Z3/evidence/git-config.baseline" 2>/dev/null)" ] || { echo ".git/config が基準値と違う（fail-closed）" >&2; exit 70; }
[ ! -f "$Z3/STOP" ] || { echo "Kernel の停止中は統合しない（kernel-resume.sh で再開してから。p0.4.0）" >&2; exit 70; }
[ "$(git -C "$REPO" branch --show-current)" = "main" ] || { echo "main の checkout で実行する" >&2; exit 64; }
[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] || { echo "main に未コミットの変更がある" >&2; exit 64; }
ts() { date +%Y-%m-%dT%H:%M:%S%z; }
# 取り消し：HEAD がこの実行の作った統合のコミット（親が before）のときだけ戻す
undo() { # before, merged
  if [ "$(git -C "$REPO" rev-parse HEAD)" = "$2" ] && [ "$(git -C "$REPO" rev-parse HEAD^1)" = "$1" ]; then git -C "$REPO" reset -q --hard "$1"
  else
    # 取り消せないときは黙らない：判定と違う・監査に落ちた統合が main に残っている可能性を記録し、停止を促す（憲法審査 20261105-221423 の注意）
    printf '{"ts":"%s","type":"release_undo_refused","task":"%s","before":"%s","merged":"%s","head":"%s"}\n' "$(ts)" "${task:-?}" "${1:0:12}" "${2:0:12}" "$(git -C "$REPO" rev-parse --short=12 HEAD)" >> "$Z3/evidence/gate_events.jsonl"
    echo "  ! HEAD がこの実行の統合のコミットではないため、取り消さない。main に統合が残っている可能性がある。kernel-stop.sh で止めて、オーナーが確かめる" >&2
  fi
}
for task in "$@"; do
  [ ! -f "$Z3/STOP" ] || { echo "Kernel が停止した。${task} 以降は統合しない" >&2; exit 70; }   # p0.4.0：票ごとに停止を見る（Codex の指摘 #6）
  rec="$(jq -c --arg t "$task" 'select(.task==$t)' "$Z3/evidence/held.jsonl" | tail -n 1)"
  [ -n "$rec" ] || { echo "✗ ${task}：夜間の合格の記録がない" >&2; exit 1; }
  req="$(printf '%s' "$rec" | jq -r .request)"; cand="$(printf '%s' "$rec" | jq -r .candidate)"
  # p0.4.3（Codex の指摘 #3）：p0.4.2 までの held は、Codex の判定の欠落を SKIPPED として合格にしえた。版の印（law）のない held と、
  #   --no-codex で起動していないのに Codex が APPROVED／CHANGES_REQUIRED でない held は統合しない（昼に申請し直す）
  if [ "$(printf '%s' "$rec" | jq -r '.law // empty')" != "p0.4.3" ]; then echo "✗ ${task}：前の版（p0.4.2 以前）か未知の版の夜間の合格の記録。司法の成立を確かめられないので統合しない。昼に申請し直す" >&2; exit 1; fi
  # 記録の形が、裁判所が held にする条件（司法が成り立ち、両方の差し戻しでなく、security は省略か合格）と合うか（Codex の再監査 #2）
  if ! printf '%s' "$rec" | jq -e '
      (.no_codex | type == "boolean")
      and (.judge == "APPROVED" or .judge == "CHANGES_REQUIRED")
      and (if .no_codex then .codex == "SKIPPED" and .judge == "APPROVED" else (.codex == "APPROVED" or .codex == "CHANGES_REQUIRED") end)
      and (.judge == "APPROVED" or .codex == "APPROVED")
      and (.security == "SKIPPED" or .security == "APPROVED")' >/dev/null 2>&1; then
    echo "✗ ${task}：夜間の合格の記録に、成り立った司法の判定がない（Codex の欠落・両方の差し戻し・security の不合格など）。統合しない" >&2; exit 1
  fi
  git -C "$REPO" cat-file -e "$cand^{commit}" || { echo "✗ ${task}：候補のコミットがない" >&2; exit 1; }
  if git -C "$REPO" merge-base --is-ancestor "$req" main; then
    echo "・${task}：申請 ${req:0:12} はすでに main に入っている（統合済み）。何もしない"; continue
  fi
  before="$(git -C "$REPO" rev-parse HEAD)"
  git -C "$REPO" -c user.name=gate-runner -c user.email=gate-runner@local merge --no-ff -q -m "gate-runner: $task を統合（夜間の判定に合格、オーナーが朝に承認）" "$req" \
    || { git -C "$REPO" merge --abort || true; echo "✗ ${task}：今の main と衝突。昼に申請し直す" >&2; exit 1; }
  merged="$(git -C "$REPO" rev-parse HEAD)"
  # 入った変更（記録の docs/tasks/ を除く）が、夜に判定した変更と一字一句同じか。複数の票を続けて承認しても、各票の変更そのものは変わらないことを確かめる
  mac="$(printf '%s' "$rec" | jq -r .main_at_check)"
  got="$(git -C "$REPO" diff --binary "$before" HEAD -- . ':(exclude)docs/tasks' | shasum -a 256 | cut -c1-64)"
  want="$(git -C "$REPO" diff --binary "$mac" "$cand" -- . ':(exclude)docs/tasks' | shasum -a 256 | cut -c1-64)"
  if [ "$got" != "$want" ]; then
    undo "$before" "$merged"
    echo "✗ ${task}：入る変更が、夜に判定した変更と違う。統合を取り消した。昼に申請し直す" >&2; exit 1
  fi
  # 組み合わせた木で決定論的な監査を sandbox の中でもう一度（夜は別々に判定したため、組み合わせの不具合をここで止める）
  wt="$(mktemp -d "${TMPDIR:-/tmp}/release-$task-XXXX")"; git -C "$REPO" worktree add --detach -q "$wt" HEAD
  SBX="$Z3/bin/sandboxed-run.sh"
  if ! ( cd "$wt" && "$SBX" --dir "$wt" --net -- npm ci --no-fund --no-audit >/dev/null 2>&1 && "$SBX" --dir "$wt" -- npm run -s test >/dev/null 2>&1 \
        && "$SBX" --dir "$wt" -- npm run -s typecheck >/dev/null 2>&1 && "$SBX" --dir "$wt" -- npm run -s lint >/dev/null 2>&1 ); then
    git -C "$REPO" worktree remove --force "$wt" || true; undo "$before" "$merged"
    echo "✗ ${task}：組み合わせた木で監査が不合格。統合を取り消した" >&2; exit 1
  fi
  git -C "$REPO" worktree remove --force "$wt" || true
  short="$(git -C "$REPO" rev-parse --short=12 HEAD)"
  printf '{"ts":"%s","type":"merged","task":"%s","main":"%s","via":"release","candidate":"%s"}\n' "$(ts)" "$task" "$short" "${cand:0:12}" >> "$Z3/evidence/gate_events.jsonl"
  git -C "$REPO" update-ref -d "refs/vgdd/held/$task" || true
  # p0.4.1：票の status を merged に（front matter の中だけ）、§6 に1行。その票だけをコミットする
  t="$(ls "$REPO"/docs/tasks/"$task"-*.md 2>/dev/null | head -n 1 || true)"
  if [ -n "$t" ]; then
    rel="docs/tasks/$(basename "$t")"
    sed -i '' -E "2,/^---\$/ s/^status: .*/status: merged/" "$t"
    printf '\n- %s release: status → merged（main=%s。夜間の判定に合格した候補 %s を、オーナーが朝に承認して統合）\n' "$(ts)" "$short" "${cand:0:12}" >> "$t"
    git -C "$REPO" add -- "$rel" && git -C "$REPO" -c user.name=gate-runner -c user.email=gate-runner@local commit -q -m "gate-runner: 記録（統合: ${task} を朝に承認）" -- "$rel"
  fi
  echo "✓ $task を統合：${short}"
done
