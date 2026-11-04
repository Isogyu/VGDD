#!/usr/bin/env bash
# VGDD — 夜間ハーネス（night-runner）。行政の長の役を機械的に代行して、承認済みの票のキューを無人で回す。
# 設計：docs/harness.md（D-55③・D-37・D-45⑦）。**案・未試験**（V8 の試験運転で確かめてから本番に使う）。
#
# 置き場所：原本は vgdd/scripts/night-runner.sh。実行用は ~/tsubuyaki-z3/bin/night-runner.sh（オーナーがコピー）。
# 動かす人：オーナー。sandbox の外で起動する。gate-runner は**別に**起動しておく（runner は gate-runner を起こさない・止めない）。
#
# 使い方:
#   caffeinate -i ~/tsubuyaki-z3/bin/night-runner.sh [--queue ~/tsubuyaki-z3/night/queue.json] [--repo ~/tsubuyaki-worklog/app]
#                                                   [--dry-run] [--parallel N] [--until HH:MM]
#     --dry-run   キューの検査とレーンの割り当てを表示するだけ。作業員は起動せず、何も書かない（V8-1）
#     --parallel  並行の作業員の数（キューの limits.parallel を上書き）
#     --until     止める時刻（キューの limits.until を上書き）
#
# 決めない・緩めない：合否は gate-runner（judge・Codex・決定論的な監査）。runner は配る・申請する・記録するだけ。
#   作業員は昼と同じ worker（claude -p --agent worker）。cwd を .claude/worktrees/ の下にして、フック p0.2.0 の閉じ込めを効かせる。
#   ask（依存の追加・push・rm・npx）は無人では承認されず拒否になる（fail-closed）。
# runner が main に書くもの：票の status と §6 の行だけ（night-runner の名でコミット）。ソースには触らない。merge はしない。

set -euo pipefail

REPO="${HOME}/tsubuyaki-worklog/app"; Z3="${VGDD_Z3_DIR:-${HOME}/tsubuyaki-z3}"

# p0.3.1：この裁判所（sandbox の外・オーナーの権限）が実行する git は、リポジトリのフックと fsmonitor を読まない（OBS-033）。
#   作業員が共有の .git/config に設定を書いても、ここでは使われない。さらに .git/config の要約をオーナーの基準値と照合し、違えば止める
git() { command git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand=ssh "$@"; }
# p0.3.1a：macOS には timeout コマンドがないため、perl の alarm で時間の上限を付ける（V8 の試し実行で判明）。
#   上限を過ぎると SIGALRM で作業員の claude を止める（終了コード 142）
run_with_timeout() { local secs="$1"; shift; perl -e 'alarm shift; exec @ARGV or exit 127' "$secs" "$@"; }
check_git_config() {
  local base="$Z3/evidence/git-config.baseline" cur
  cur="$(shasum -a 256 "$REPO/.git/config" | cut -c1-64)"
  if [ ! -f "$base" ]; then echo "git の設定の基準値がない（$base）。オーナーが vgdd/scripts/git-baseline.sh で作る（fail-closed）" >&2; exit 70; fi
  [ "$cur" = "$(cat "$base")" ] || { echo "共有の .git/config が基準値から変わっている。オーナーが確かめるまで止める（fail-closed。OBS-033）" >&2; exit 70; }
}
QUEUE="$Z3/night/queue.json"; DRY=0; PARALLEL=""; UNTIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --queue) QUEUE="$2"; shift 2;;
    --repo) REPO="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    --parallel) PARALLEL="$2"; shift 2;;
    --until) UNTIL="$2"; shift 2;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) echo "不明な引数: $1" >&2; exit 64;;
  esac
done
command -v jq >/dev/null || { echo "jq が必要" >&2; exit 69; }
command -v claude >/dev/null || { echo "claude CLI が必要" >&2; exit 69; }
[ -f "$QUEUE" ] || { echo "キューがない: ${QUEUE}（オーナーが承認して Z3 に置く）" >&2; exit 66; }

NIGHT="$Z3/night"; DATE="$(date +%Y-%m-%d)"
LOGS="$NIGHT/logs/$DATE"; SUMMARY="$NIGHT/summary-$DATE.json"; STOP_FILE="$NIGHT/STOP"
EVENTS="$Z3/evidence/gate_events.jsonl"; TOOLCALLS="$Z3/evidence/tool_calls.jsonl"; VERDICTS="$Z3/evidence/verdicts"
REQ_DIR="$REPO/merge-requests"; WT_BASE="$REPO/.claude/worktrees"
mkdir -p "$LOGS"

# ---- 上限（キューの limits。引数が優先） --------------------------------------------------------------
lim() { jq -r --arg k "$1" --arg d "$2" '.limits[$k] // $d' "$QUEUE"; }
PARALLEL="${PARALLEL:-$(lim parallel 2)}"; UNTIL="${UNTIL:-$(lim until 06:30)}"
MAX_TICKETS="$(lim max_tickets 6)"; MAX_JUDGE="$(lim max_judge_calls 20)"
MAX_TOK_TICKET="$(lim max_tokens_per_ticket 2000000)"; MAX_TOK_TOTAL="$(lim max_tokens_total 12000000)"
MIN_FREE_GB="$(lim min_free_gb 3)"
[ "$PARALLEL" -le 4 ] || PARALLEL=4   # D-45：同時最大4

ts() { date +%Y-%m-%dT%H:%M:%S%z; }
log() { echo "[$(ts)] $*"; }
RUN_ID="night-$DATE-$$"
RUN_START="$(ts)"   # p0.3.1b：この夜の運転の開始。これより前の記録は止める条件に数えない（OBS-037）
STARTED=0; MERGED=0; REJECTED=0; BLOCKED=0; SKIPPED=0; TOK_TOTAL=0; FAIL_STREAK=0; STOP_REASON=""
declare -a NOTES=()
note() { NOTES+=("$1"); log "$1"; }

# ---- 票の読み取り（gate-runner と同じ関数） ------------------------------------------------------------
ticket_path() { ls "$REPO"/docs/tasks/"$1"-*.md 2>/dev/null | head -n 1; }
front() { sed -n '/^---$/,/^---$/p' "$1" | sed -n "s/^$2: *//p" | head -n 1 | sed 's/ *#.*$//'; }
front_list() {
  awk -v key="$2" '
    /^---$/ { fm++; next } fm!=1 { next }
    $0 ~ "^"key":" { inlist=1; next }
    inlist && /^  - / { sub(/^  - /, ""); sub(/ *#.*$/, ""); print; next }
    inlist && !/^  / { inlist=0 }
  ' "$1"
}
depends_merged() { # ticket → 0 なら depends_on がすべて merged
  local deps; deps="$(front "$1" depends_on | tr -d '[]' | tr ',' '\n' | tr -d ' ')"
  local d t
  for d in $deps; do
    t="$(ticket_path "$d")"; [ -n "$t" ] || return 1
    [ "$(front "$t" status)" = "merged" ] || return 1
  done
  return 0
}
returns_of() { grep -c 'gate-runner: status → in_progress' "$1" 2>/dev/null || true; }

# ---- 止める条件（1つでも当たれば新しい票を取らない） ---------------------------------------------------
free_gb() { df -g "$REPO" | awk 'NR==2 {print $4}'; }
gate_alive() { pgrep -f 'gate-runner.sh' >/dev/null 2>&1; }
deny_recent() { # 直近10分の deny の件数（p0.3.1b：証拠ストアの時刻の項目は timestamp。以前は .ts を読み、いつも 0 件だった。OBS-038）
  [ -f "$TOOLCALLS" ] || { echo 0; return; }
  local since; since="$(date -v-10M +%Y-%m-%dT%H:%M 2>/dev/null || date -d '-10 min' +%Y-%m-%dT%H:%M)"
  tail -n 2000 "$TOOLCALLS" | jq -r --arg s "$since" 'select(.decision=="deny" and (.timestamp // "") >= $s) | 1' 2>/dev/null | wc -l | tr -d ' '
}
outside_gate() { # p0.3.1b：この夜の運転の開始より後の記録だけを見る（夜の前の立法のコミットで止まらない。OBS-037）
  [ -f "$EVENTS" ] && grep -q '"type":"main_advanced_outside_gate"' "$EVENTS" && \
  tail -n 200 "$EVENTS" | jq -r --arg s "$RUN_START" 'select(.type=="main_advanced_outside_gate" and (.ts // "") >= $s) | .author // ""' | grep -v -q 'night-runner'; }
judge_calls_tonight() { find "$VERDICTS" -name '*.json' -newer "$QUEUE" 2>/dev/null | wc -l | tr -d ' '; }
past_until() { [ "$(date +%H:%M)" \> "$UNTIL" ] && [ "$(date +%H)" -lt 12 ]; }
should_stop() {
  if [ -f "$STOP_FILE" ]; then STOP_REASON="オーナーの停止（STOP ファイル）"; return 0; fi
  if past_until; then STOP_REASON="時刻 ${UNTIL} を過ぎた"; return 0; fi
  if ! gate_alive; then STOP_REASON="gate-runner が動いていない"; return 0; fi
  if outside_gate; then STOP_REASON="main_advanced_outside_gate を検知"; return 0; fi
  if [ "$(deny_recent)" -gt 30 ]; then STOP_REASON="直近10分の拒否が30件を超えた"; return 0; fi
  if [ "$FAIL_STREAK" -ge 2 ]; then STOP_REASON="2票続けて失敗"; return 0; fi
  if [ "$(free_gb)" -lt "$MIN_FREE_GB" ]; then STOP_REASON="空き容量が ${MIN_FREE_GB}GB 未満"; return 0; fi
  if [ "$(judge_calls_tonight)" -ge "$MAX_JUDGE" ]; then STOP_REASON="司法の呼び出しが上限 ${MAX_JUDGE} に達した"; return 0; fi
  if [ "$TOK_TOTAL" -ge "$MAX_TOK_TOTAL" ]; then STOP_REASON="トークンの合計が上限に達した"; return 0; fi
  return 1
}

# ---- 作業員の起動（headless。cwd は worktree） -------------------------------------------------------------
worker_prompt() { # task, ticket_rel, extra
  cat <<EOF
あなたは作業員（worker）。票 ${2}（main に固定済み。§2 の受け入れ条件は変更しない）を、この worktree のブランチで実装してください。応答・コミットメッセージ・コメントは日本語。
手順：1) date・pwd・git branch --show-current・git rev-parse HEAD を確認 2) 票を最後まで読む 3) npm ci --cache "\$TMPDIR/npm-cache" を1回 4) files_allowed の中だけを書く 5) npm run -s test・typecheck・lint をすべて通す 6) git add はパス指定、コミットは1つ（先頭 "${1}: "、末尾 "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"）。
守ること：files_forbidden と票の外のファイルは触らない。.env.local は読まない。実在の会社名・人名を書かない。git rebase・merge・push・main への checkout はしない。依存の追加はできない（拒否される。必要なら報告に書いて止まる）。拒否されたら回避せず報告する。
${3}
最後のメッセージで報告：ブランチ・HEAD、git diff --stat main..HEAD、test/typecheck/lint の結果（実行した出力の要点）、A 条件ごとの達成状況、逸脱・拒否。
EOF
}
run_worker() { # task, wt, attempt, extra → log json path。失敗なら非0
  local task="$1" wt="$2" attempt="$3" extra="$4"
  local t; t="$(ticket_path "$task")"; local trel="docs/tasks/$(basename "$t")"
  local limit; limit="$(front "$t" time_limit_min)"; limit="${limit:-45}"
  local out="$LOGS/${task}-${attempt}.json"
  log "▶ ${task} 作業員を起動（試行 ${attempt}、上限 ${limit}+10 分、worktree ${wt}）"
  ( cd "$wt" && run_with_timeout "$(( (limit + 10) * 60 ))" claude -p --agent worker --output-format json --max-turns 80 \
      "$(worker_prompt "$task" "$trel" "$extra")" ) > "$out" 2> "$LOGS/${task}-${attempt}.err" || true
  local tok; tok="$(jq -r '(.usage.input_tokens // 0) + (.usage.output_tokens // 0)' "$out" 2>/dev/null || echo 0)"
  TOK_TOTAL=$(( TOK_TOTAL + tok ))
  if grep -q -i -E 'usage limit|rate limit|利用上限' "$out" "$LOGS/${task}-${attempt}.err" 2>/dev/null; then
    STOP_REASON="claude の利用上限の文言"; return 2
  fi
  [ "$tok" -le "$MAX_TOK_TICKET" ] || { note "${task}: トークン ${tok} が1票の上限を超えた"; return 1; }
  return 0
}

# ---- 前検査（gate-runner の段階 1〜4 を先に機械で見る。合否ではなく無駄な差し戻しを減らすため） -------------------
PROTECTED_RE='^(\.claude/|CLAUDE\.md$|\.github/|vgdd/|docs/requirements\.md$|docs/tasks/|merge-requests/)'
precheck() { # task, wt → 0 なら申請へ。stdout に理由
  local task="$1" wt="$2"; local t; t="$(ticket_path "$task")"
  local n; n="$(git -C "$REPO" rev-list --count "main..night/$task")"
  [ "$n" -ge 1 ] || { echo "コミットがない"; return 1; }
  local changed; changed="$(git -C "$REPO" diff --name-only "main...night/$task")"
  printf '%s\n' "$changed" | grep -Eq "$PROTECTED_RE" && { echo "保護パスへの変更: $(printf '%s\n' "$changed" | grep -E "$PROTECTED_RE" | tr '\n' ' ')"; return 1; }
  local allowed; allowed="$(front_list "$t" files_allowed)"; local outside="" f a okf
  while IFS= read -r f; do
    [ -n "$f" ] || continue; okf=0
    while IFS= read -r a; do
      [ -n "$a" ] || continue
      if [[ "$f" == "$a" ]]; then okf=1; elif [[ "$a" == *"*"* ]] && [[ "$f" == $a ]]; then okf=1; fi
    done <<< "$allowed"
    [ "$okf" -eq 1 ] || outside="$outside $f"
  done <<< "$changed"
  [ -z "$outside" ] || { echo "files_allowed の外:${outside}"; return 1; }
  git -C "$REPO" diff "main...night/$task" | grep -qE 'sk-ant-api03-[A-Za-z0-9]{40,}|BEGIN (RSA|OPENSSH|PRIVATE)|@gmail\.com|AKIA[0-9A-Z]{16}' && { echo "秘密情報らしい文字列"; return 1; }
  if [ -d "$wt/node_modules" ]; then
    # p0.3.1：作業員の書いたテストは sandbox の中で実行する（OBS-034。gate-runner と同じ sandboxed-run.sh）
    ( cd "$wt" && "$Z3/bin/sandboxed-run.sh" --dir "$wt" -- npm run -s test >/dev/null 2>&1 ) || { echo "npm test が不合格"; return 1; }
  fi
  echo "OK"; return 0
}

# ---- 票を review にして main にコミット（§2 は触らない） --------------------------------------------------
mark_review() { # task, head, note
  local t; t="$(ticket_path "$1")"
  sed -i '' -E "s/^status: .*/status: review/" "$t"
  printf '\n- %s night-runner: 作業員の実装を前検査で確認（HEAD %s）。status → review で再申請（%s）\n' "$(ts)" "${2:0:7}" "$3" >> "$t"
  git -C "$REPO" add "docs/tasks/$(basename "$t")"
  git -C "$REPO" -c user.name=night-runner -c user.email=night-runner@local commit -q -m "night-runner: ${1} を review に（§2 は変えない）"
}

# ---- 申請と、gate-runner の結果待ち（1件ずつ） ----------------------------------------------------------------
wait_gate() { # task → merged|rejected|blocked|timeout
  local task="$1" i
  for i in $(seq 1 120); do   # 最長 20 分
    sleep 10
    [ -f "$REQ_DIR/$task.json" ] && continue
    local last; last="$(grep "\"task\":\"$task\"" "$EVENTS" 2>/dev/null | tail -n 1)"
    case "$(printf '%s' "$last" | jq -r '.type // ""')" in
      merged|held) echo merged; return;;   # p0.3.1：夜間の gate-runner --hold では、合格は held（朝に release.sh で統合）
      rejected) [ "$(printf '%s' "$last" | jq -r '.status // ""')" = "blocked" ] && echo blocked || echo rejected; return;;
    esac
  done
  echo timeout
}
request() { # task, head
  local task="$1" head="$2"
  jq -n --arg task "$task" --arg branch "night/$task" --arg head "$head" --arg ts "$(ts)" --arg run "$RUN_ID" \
    '{task:$task, branch:$branch, head:$head, requirements_source:"ticket", worker:"night-worker",
      requested_by:"night-runner（行政の長の夜間の代行）", requested_at:$ts, note:("夜間ハーネス " + $run + "。票の §2 は main のもの。前検査は runner が実施")}' \
    > "$REQ_DIR/$task.json"
}

# ---- 1レーン（1票）。2回まで（初回＋やり直し1回） ------------------------------------------------------------------
run_lane() { # task
  local task="$1" wt="$WT_BASE/night-$task" attempt=1 extra="" head res why
  git -C "$REPO" worktree add "$wt" -b "night/$task" main >/dev/null 2>&1 || { note "${task}: worktree を作れない"; FAIL_STREAK=$((FAIL_STREAK+1)); return; }
  STARTED=$((STARTED+1))
  while [ "$attempt" -le 2 ]; do
    run_worker "$task" "$wt" "$attempt" "$extra"; local rc=$?
    [ "$rc" -eq 2 ] && return
    why="$(precheck "$task" "$wt")" || { note "${task}: 前検査で落ちた（${why}）"; extra="前回の問題：${why}。直してからコミットしてください。"; attempt=$((attempt+1)); continue; }
    git -C "$wt" rebase main >/dev/null 2>&1 || { git -C "$wt" rebase --abort >/dev/null 2>&1 || true; note "${task}: rebase の衝突"; extra="main との衝突を直してください（git rebase main）。"; attempt=$((attempt+1)); continue; }
    head="$(git -C "$REPO" rev-parse "night/$task")"
    mark_review "$task" "$head" "試行 ${attempt}"
    git -C "$wt" rebase main >/dev/null 2>&1 || true   # status のコミットを取り込む（docs だけなので衝突しない）
    head="$(git -C "$REPO" rev-parse "night/$task")"
    request "$task" "$head"
    res="$(wait_gate "$task")"
    case "$res" in
      merged) MERGED=$((MERGED+1)); FAIL_STREAK=0; note "${task}: 判定に合格（朝の承認待ち。統合はオーナーが release.sh で行う）"; git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true; return;;   # p0.3.1：ブランチは朝の release のために残す
      rejected) REJECTED=$((REJECTED+1)); why="$(tail -n 3 "$(ticket_path "$task")" | grep 'gate-runner: status' | tail -n 1)"; extra="差し戻しの理由（gate-runner）：${why}。これを直してからコミットしてください。"; attempt=$((attempt+1));;
      blocked) BLOCKED=$((BLOCKED+1)); note "${task}: blocked（朝にオーナーの裁定）"; FAIL_STREAK=$((FAIL_STREAK+1)); return;;
      timeout) note "${task}: gate-runner の結果を 20 分待っても出ない"; FAIL_STREAK=$((FAIL_STREAK+1)); return;;
    esac
  done
  FAIL_STREAK=$((FAIL_STREAK+1)); note "${task}: 2回で通らず。朝に確認"
}

# ---- 本体 -------------------------------------------------------------------------------------------------------
log "night-runner 起動 run_id=${RUN_ID} parallel=${PARALLEL} until=${UNTIL} max_tickets=${MAX_TICKETS} dry_run=${DRY}"
[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] || { echo "main の checkout に未コミットの変更がある。片付けてから" >&2; exit 65; }
QUEUE_TASKS="$(jq -r '.tickets[]' "$QUEUE")"
TAKEN=0; declare -a PIDS=() LANES=()
for task in $QUEUE_TASKS; do
  t="$(ticket_path "$task")"
  if [ -z "$t" ]; then note "${task}: 票がない"; SKIPPED=$((SKIPPED+1)); continue; fi
  st="$(front "$t" status)"
  if ! { [ "$st" = "ready" ] || { [ "$st" = "in_progress" ] && [ "$(returns_of "$t")" -lt 3 ]; }; }; then note "${task}: status=${st} のため飛ばす"; SKIPPED=$((SKIPPED+1)); continue; fi
  [ "$(front "$t" requirements_source)" = "ticket" ] || { note "${task}: requirements_source が ticket ではない"; SKIPPED=$((SKIPPED+1)); continue; }
  [ "$(front "$t" unattended)" = "true" ] || { note "${task}: unattended: true ではない（オーナーの判断が要る票）"; SKIPPED=$((SKIPPED+1)); continue; }
  depends_merged "$t" || { note "${task}: depends_on が未統合。後に回す"; SKIPPED=$((SKIPPED+1)); continue; }
  [ "$TAKEN" -lt "$MAX_TICKETS" ] || { note "1晩の票の上限 ${MAX_TICKETS}"; break; }
  if should_stop; then note "停止: ${STOP_REASON}"; break; fi
  if [ "$DRY" -eq 1 ]; then log "（dry-run）${task} をレーンに割り当てる"; TAKEN=$((TAKEN+1)); continue; fi
  # レーンが空くまで待つ
  while [ "${#PIDS[@]}" -ge "$PARALLEL" ]; do
    wait -n 2>/dev/null || true
    for i in "${!PIDS[@]}"; do kill -0 "${PIDS[$i]}" 2>/dev/null || unset 'PIDS[i]'; done
    PIDS=("${PIDS[@]}")
  done
  run_lane "$task" & PIDS+=("$!"); LANES+=("$task"); TAKEN=$((TAKEN+1))
  sleep 5
done
wait 2>/dev/null || true
[ -n "$STOP_REASON" ] || STOP_REASON="キューを使い切った"

jq -n --arg run "$RUN_ID" --arg date "$DATE" --arg stop "$STOP_REASON" --argjson started "$STARTED" --argjson merged "$MERGED" \
  --argjson rejected "$REJECTED" --argjson blocked "$BLOCKED" --argjson skipped "$SKIPPED" --argjson tokens "$TOK_TOTAL" \
  --argjson judge "$(judge_calls_tonight)" --arg notes "$(printf '%s\n' "${NOTES[@]:-}")" \
  '{schema:"vgdd.night-summary.v1", run_id:$run, date:$date, stop_reason:$stop, started:$started, merged:$merged, rejected:$rejected,
    blocked:$blocked, skipped:$skipped, tokens_total:$tokens, judge_calls:$judge, notes:($notes|split("\n")|map(select(.!="")))}' > "$SUMMARY"
log "終了: ${STOP_REASON}。summary=${SUMMARY}"
