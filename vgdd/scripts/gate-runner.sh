#!/usr/bin/env bash
# VGDD Phase 1 — 裁判所の執行（gate-runner）。統合の法律（docs/governance.md §3）を機械的に適用する。
#
# 置き場所：原本はリポジトリの vgdd/scripts/gate-runner.sh。実行用は ~/tsubuyaki-z3/bin/gate-runner.sh（オーナーがコピー）。
# 動かす人：オーナー。sandbox の外で1回起動すると常駐し、merge-requests/*.json を拾って処理する（D-47①）。
#   行政（Max とそのサブエージェント）はこのスクリプトを実行できない（vgdd/ は保護パス、Z3 に書けない、main に merge できない）。
#
# 使い方:
#   ~/tsubuyaki-z3/bin/gate-runner.sh [--repo ~/tsubuyaki-worklog/app] [--interval 30] [--once] [--no-codex]
#     --once      1回だけ処理して終わる（試運転用）
#     --no-codex  Codex judge を省く（Codex が使えない環境の試運転用。judge だけで統合する。README に明記すること）
#
# 1申請の流れ（1つでも落ちれば統合しない。判定は Z3 の evidence/verdicts/ と gate_events.jsonl に残る）:
#   1 申請と票の整合（status: review、HEAD が一致）
#   2 統合キュー（p0.3.1 案）：main を含まないブランチは、一時 worktree で「最新の main ＋ 申請の SHA」の候補を作る（衝突なら needs_rebase）。
#     以後の検査・判定・統合は候補に対して行う。鎖で積まなくてよく、前の票が止まっても後ろの票は止まらない
#   3 差分が票の files_allowed の中だけ。保護パスが含まれていれば即拒否
#   4 秘密情報らしい文字列・実名の形がない
#   5 一時 worktree で npm ci → npm test → typecheck → lint
#   6 judge.sh（Claude）→ 7 judge-codex.sh（Codex）→ 8 不一致の扱い（critical・major が分かれたら blocked）
#   9 security_review の票は judge-codex.sh --security も
#  10 合格なら main で git merge --ff-only <候補> → 票を merged に、§6 に記録、_board.json を更新、申請を done/ に移す。
#     1件統合するたびに、残りの申請は次の周回で最新の main と組み合わせて 2〜10 をやり直す
#
# 前提: jq、node、npm、codex（--no-codex でなければ）。main の checkout に未コミットの変更がないこと。

set -euo pipefail

export VGDD_AUDIT_WRAP="${VGDD_Z3_DIR:-${HOME}/tsubuyaki-z3}/bin/sandboxed-run.sh"  # p0.3.0：judge.sh の監査も sandbox の中
REPO="${HOME}/tsubuyaki-worklog/app"; INTERVAL=30; ONCE=0; NO_CODEX=0; RUN_MERGED=""; HOLD=0
Z3="${VGDD_Z3_DIR:-${HOME}/tsubuyaki-z3}"

# p0.3.1：この裁判所（sandbox の外・オーナーの権限）が実行する git は、リポジトリのフックと fsmonitor を読まない（OBS-033）。
#   作業員が共有の .git/config に設定を書いても、ここでは使われない。さらに .git/config の要約をオーナーの基準値と照合し、違えば止める
git() { command git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand=ssh "$@"; }
check_git_config() {
  local base="$Z3/evidence/git-config.baseline" cur
  cur="$(shasum -a 256 "$REPO/.git/config" | cut -c1-64)"
  if [ ! -f "$base" ]; then echo "git の設定の基準値がない（$base）。オーナーが vgdd/scripts/git-baseline.sh で作る（fail-closed）" >&2; exit 70; fi
  [ "$cur" = "$(cat "$base")" ] || { echo "共有の .git/config が基準値から変わっている。オーナーが確かめるまで止める（fail-closed。OBS-033）" >&2; exit 70; }
}
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --interval) INTERVAL="$2"; shift 2;;
    --once) ONCE=1; shift;;
    --hold) HOLD=1; shift;;   # p0.3.1：夜間。判定までで統合しない（朝にオーナーが release.sh で承認して統合する）
    --no-codex) NO_CODEX=1; shift;;
    *) echo "不明な引数: $1" >&2; exit 64;;
  esac
done

Z3="${VGDD_Z3_DIR:-${HOME}/tsubuyaki-z3}"
VERDICTS="$Z3/evidence/verdicts"
EVENTS="$Z3/evidence/gate_events.jsonl"
BIN="$Z3/bin"                      # judge.sh / judge-codex.sh の実行用コピーもここに置く
REQ_DIR="$REPO/merge-requests"
DONE_DIR="$REQ_DIR/done"
BOARD="$REPO/docs/tasks/_board.json"
PROTECTED_RE='^(\.claude/|CLAUDE\.md$|\.github/|vgdd/|docs/requirements\.md$|docs/tasks/_board\.json$|merge-requests/)'
MAX_RETURNS=3                       # 差し戻しの上限（D-05）

mkdir -p "$VERDICTS" "$DONE_DIR"
command -v jq >/dev/null || { echo "jq が必要" >&2; exit 69; }

ts() { date +%Y-%m-%dT%H:%M:%S%z; }
log_event() { # type, task, json-extra
  printf '{"ts":"%s","type":"%s","task":"%s",%s}\n' "$(ts)" "$1" "$2" "$3" >> "$EVENTS"
}
fail() { # task, reason, new_status
  local task="$1" reason="$2" status="${3:-in_progress}"
  echo "  ✗ $task: $reason" >&2
  log_event "rejected" "$task" "\"reason\":$(jq -Rn --arg r "$reason" '$r'),\"status\":\"$status\""
  set_ticket_status "$task" "$status" "$reason"
}

ticket_path() { ls "$REPO"/docs/tasks/"$1"-*.md 2>/dev/null | head -n 1; }
front() { # ticket, key → value（1行の値。配列は未対応）
  sed -n '/^---$/,/^---$/p' "$1" | sed -n "s/^$2: *//p" | head -n 1 | sed 's/ *#.*$//'
}
front_list() { # ticket, key → 配列の要素（- で始まる行）
  awk -v key="$2" '
    /^---$/ { fm++; next } fm!=1 { next }
    $0 ~ "^"key":" { inlist=1; next }
    inlist && /^  - / { sub(/^  - /, ""); sub(/ *#.*$/, ""); print; next }
    inlist && !/^  / { inlist=0 }
  ' "$1"
}
set_ticket_status() { # task, status, note
  local t; t="$(ticket_path "$1")"; [ -n "$t" ] || return 0
  sed -i '' -E "s/^status: .*/status: $2/" "$t"
  printf '\n- %s gate-runner: status → %s%s\n' "$(ts)" "$2" "${3:+（$3）}" >> "$t"
}
update_board() { # 全票から _board.json を作り直す（gate-runner だけが書く）
  node - "$REPO/docs/tasks" "$BOARD" "$EVENTS" <<'NODE'
const fs = require('fs'); const path = require('path');
const [dir, out, events] = process.argv.slice(2);
const tickets = fs.readdirSync(dir).filter(f => /^T-\d+-.*\.md$/.test(f)).map(f => {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  const fm = (s.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const get = k => (fm.match(new RegExp(`^${k}: *(.*)$`, 'm')) || [])[1]?.replace(/ *#.*$/, '').trim() ?? null;
  return { id: get('id'), title: get('title'), status: get('status'), estimate_h: Number(get('estimate_h')) || null };
});
const ev = fs.existsSync(events) ? fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const count = (type, task) => ev.filter(e => e.type === type && (!task || e.task === task)).length;
for (const t of tickets) { t.returns = count('rejected', t.id); t.merged_at = (ev.filter(e => e.type === 'merged' && e.task === t.id).pop() || {}).ts || null; t.disagreements = count('disagreement', t.id); }
const board = {
  schema: 'vgdd.board.v1', generated_at: new Date(Date.now() + 9 * 3600e3).toISOString().replace('Z', '+09:00'),
  totals: { tickets: tickets.length, merged: count('merged'), rejected: count('rejected'), blocked: count('blocked'), disagreements: count('disagreement') },
  tickets,
};
fs.writeFileSync(out, JSON.stringify(board, null, 2) + '\n');
NODE
}

process_request() {
  local req="$1"
  local task branch sha reqs trel src_main
  task="$(jq -r '.task' "$req")"; branch="$(jq -r '.branch' "$req")"; sha="$(jq -r '.head' "$req")"
  echo "▶ $task（$branch @ $sha）"
  local t; t="$(ticket_path "$task")"
  [ -n "$t" ] || { fail "$task" "票が見つからない" "blocked"; mv "$req" "$DONE_DIR/"; return; }

  # 1 整合
  [ "$(front "$t" status)" = "review" ] || { fail "$task" "票の status が review ではない（$(front "$t" status)）"; mv "$req" "$DONE_DIR/"; return; }
  # p0.2.1（OBS-015②）：基盤の票は main にコミット済みの票の requirements_source を見る。作業ツリーの票だけが ticket なら差し戻す
  trel="docs/tasks/$(basename "$t")"
  src_main="$(git -C "$REPO" show "main:$trel" 2>/dev/null | sed -n '/^---$/,/^---$/p' | sed -n 's/^requirements_source: *//p' | head -n 1 | sed 's/ *#.*$//' | tr -d ' ')"
  if [ "$(front "$t" requirements_source)" = "ticket" ] && [ "$src_main" != "ticket" ]; then
    fail "$task" "基盤の票（requirements_source: ticket）が main にコミットされていない、または main の票と違う。票は作業前に main にコミットする" "blocked"; mv "$req" "$DONE_DIR/"; return
  fi
  git -C "$REPO" rev-parse --verify -q "$branch" >/dev/null || { fail "$task" "ブランチ $branch がない" "blocked"; mv "$req" "$DONE_DIR/"; return; }
  local actual; actual="$(git -C "$REPO" rev-parse "$branch")"
  # p0.3.0：以後の検査・判定・統合は、この完全な SHA（$actual）に固定する。ブランチ名は使わない（OBS-023②）
  [[ "$actual" == "$sha"* ]] || { fail "$task" "申請の HEAD（$sha）とブランチの HEAD（${actual:0:12}）が違う"; mv "$req" "$DONE_DIR/"; return; }
  local returns; returns="$(grep -c 'gate-runner: status → in_progress' "$t" || true)"
  # p0.2.4：オーナーが取り消した差し戻し（法律の不具合・鎖の連鎖によるもの）は数えない。取り消しの記録は Z3 にあり、行政は書けない（OBS-020）
  local annulled; annulled="$(grep -c "\"task\":\"$task\"" "$Z3/evidence/annulments.jsonl" 2>/dev/null || true)"; annulled="${annulled:-0}"
  returns=$(( returns - annulled )); [ "$returns" -ge 0 ] || returns=0
  [ "$returns" -lt "$MAX_RETURNS" ] || { fail "$task" "差し戻しが $MAX_RETURNS 回に達した。オーナーの判断へ" "blocked"; mv "$req" "$DONE_DIR/"; return; }

  # 2 統合キュー（p0.3.1 案、D-55③）：ブランチが main を含んでいなくても差し戻さない。
  #   一時 worktree で「最新の main に申請の SHA を merge した候補のコミット」を作り、以後の検査・判定（3〜9）と統合（10）は
  #   その候補に対して行う。候補は main を親に持つので、統合は常に fast-forward（検査した木＝統合される木。p0.3.0 の SHA の固定は保つ）。
  #   衝突すれば needs_rebase で差し戻す。鎖で積まなくてよく、前の票が止まっても後ろの票は止まらない（OBS-019・OBS-024 の連鎖の解消）。
  #   p0.2.4 の「記録のコミットだけ遅れている」場合もこの経路で吸収する。
  local candidate="$actual" main_sha; main_sha="$(git -C "$REPO" rev-parse main)"
  local wt; wt="$(mktemp -d "${TMPDIR:-/tmp}/gate-$task-XXXX")"
  if git -C "$REPO" merge-base --is-ancestor main "$actual"; then
    git -C "$REPO" worktree add --detach "$wt" "$actual" >/dev/null 2>&1
  else
    git -C "$REPO" worktree add --detach "$wt" main >/dev/null 2>&1
    if ! git -C "$wt" -c user.name=gate-runner -c user.email=gate-runner@local merge --no-ff --no-edit -q \
         -m "gate-runner: $task を main ${main_sha:0:12} と組み合わせた候補（申請 ${actual:0:12}）" "$actual" >/dev/null 2>&1; then
      git -C "$wt" merge --abort >/dev/null 2>&1 || true
      git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
      fail "$task" "main と衝突する（needs_rebase。files_allowed が重なる票が先に統合された可能性）"; mv "$req" "$DONE_DIR/"; return
    fi
    candidate="$(git -C "$wt" rev-parse HEAD)"
    log_event "candidate" "$task" "\"request\":\"${actual:0:12}\",\"main\":\"${main_sha:0:12}\",\"candidate\":\"${candidate:0:12}\""
  fi
  # 以後、差分の範囲（3・4）は申請の SHA の変更分（main...$actual）で見る。監査・判定・統合は候補の木（$wt、$candidate）で行う

  # 3 差分の範囲
  local changed; changed="$(git -C "$REPO" diff --name-only "main...$actual")"
  if printf '%s\n' "$changed" | grep -Eq "$PROTECTED_RE"; then
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "$task" "保護パスへの変更が含まれている: $(printf '%s\n' "$changed" | grep -E "$PROTECTED_RE" | tr '\n' ' ')" "blocked"; mv "$req" "$DONE_DIR/"; return
  fi
  local allowed; allowed="$(front_list "$t" files_allowed)"
  local outside=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    local okf=0
    # p0.2.2：files_allowed は文字どおりに照合する。[id] のような Next.js の動的ルートの角かっこを
    # グロブの文字クラスと解釈しないため。* を含む項目だけをグロブとして扱う（OBS-017）。
    while IFS= read -r a; do
      [ -n "$a" ] || continue
      if [[ "$f" == "$a" ]]; then okf=1
      elif [[ "$a" == *"*"* ]] && [[ "$f" == $a ]]; then okf=1
      fi
    done <<< "$allowed"
    [ "$okf" -eq 1 ] || outside="$outside $f"
  done <<< "$changed"
  [ -z "$outside" ] || { git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true; fail "$task" "files_allowed の外を変更している:$outside"; mv "$req" "$DONE_DIR/"; return; }

  # 4 秘密情報・実名
  if git -C "$REPO" diff "main...$actual" | grep -nE 'sk-ant-api03-[A-Za-z0-9]{40,}|BEGIN (RSA|OPENSSH|PRIVATE)|@gmail\.com|password *=|AKIA[0-9A-Z]{16}' >/dev/null; then
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "$task" "秘密情報らしい文字列が差分にある" "blocked"; mv "$req" "$DONE_DIR/"; return
  fi
  if [ -f "$Z3/eval/banned-terms.txt" ] && git -C "$REPO" diff "main...$actual" | grep -nFf "$Z3/eval/banned-terms.txt" >/dev/null; then
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "$task" "実案件・実名の語が差分にある（Z3 の一覧に一致）" "blocked"; mv "$req" "$DONE_DIR/"; return
  fi

  # 5 決定論的な監査（段階 2 で作った一時 worktree ＝ 候補の木）
  local audit_ok=1
  # p0.3.0：作業員の書いたコード（テスト・設定・npm のスクリプト）は sandbox-exec の中で実行する（OBS-023①）。
  # 書き込みは一時 worktree と一時領域だけ、Z3・.env.local は読めない、テストの間はネットワークなし
  local SBX="$BIN/sandboxed-run.sh"
  [ -x "$SBX" ] || { git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true; fail "$task" "sandboxed-run.sh がない（fail-closed）" "blocked"; mv "$req" "$DONE_DIR/"; return; }
  ( cd "$wt" && "$SBX" --dir "$wt" --net -- npm ci --no-fund --no-audit >/dev/null 2>&1 \
      && "$SBX" --dir "$wt" -- npm run -s test >/dev/null 2>&1 \
      && "$SBX" --dir "$wt" -- npm run -s typecheck >/dev/null 2>&1 \
      && "$SBX" --dir "$wt" -- npm run -s lint >/dev/null 2>&1 ) || audit_ok=0
  if [ "$audit_ok" -ne 1 ]; then
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "$task" "決定論的な監査（test/typecheck/lint）が不合格"; mv "$req" "$DONE_DIR/"; return
  fi

  # 6〜9 司法（Claude judge → Codex judge → 不一致 → セキュリティ）
  reqs="$(front_list "$t" requirements | tr '\n' ',' | sed 's/,$//')"
  [ -n "$reqs" ] || reqs="$(front "$t" requirements | tr -d '[]' | tr -d ' ')"
  # p0.2.1：基盤の票（requirements_source: ticket）は、docs/requirements.md ではなく票の受け入れ条件を要件として渡す（--ticket）。
  #   judge.sh は main にコミット済みの票（git show main:docs/tasks/…）から節と「- A1.」… の ID を読み、ブランチの票と違えば fail-closed（OBS-015②）
  local -a reqargs
  if [ "$src_main" = "ticket" ]; then reqargs=(--ticket "$trel"); else reqargs=(--req "$reqs"); fi
  local jout="$VERDICTS/$task-$sha-judge.json"
  ( cd "$wt" && "$BIN/judge.sh" "${reqargs[@]}" --base main --task "$task" --out "$VERDICTS" ) >/dev/null 2>&1 || true
  local jfile; jfile="$(ls -t "$VERDICTS/$task-"*.json 2>/dev/null | grep -v codex | head -n 1)"
  local jv="CHANGES_REQUIRED"; [ -n "$jfile" ] && jv="$(jq -r '.final_verdict' "$jfile")"
  local cv="SKIPPED" cfile=""
  if [ "$NO_CODEX" -eq 0 ]; then
    ( cd "$wt" && "$BIN/judge-codex.sh" "${reqargs[@]}" --base main --task "$task" --out "$VERDICTS" ) >/dev/null 2>&1 || true
    cfile="$(ls -t "$VERDICTS/$task-"*-codex-judge.json 2>/dev/null | head -n 1)"
    [ -n "$cfile" ] && cv="$(jq -r '.final_verdict' "$cfile")"
  fi
  # p0.3.0a：セキュリティ審査は、監査を済ませた同じ一時 worktree（同じ SHA、node_modules あり）で行う。
  #   別の worktree を作ると依存がなく、審査の中の監査が「vitest が見つからない」で落ちていた（OBS-025）
  local sv="SKIPPED"
  if [ "$(front "$t" security_review)" = "true" ] && [ "$NO_CODEX" -eq 0 ]; then
    ( cd "$wt" && "$BIN/judge-codex.sh" --security "${reqargs[@]}" --base main --task "$task" --out "$VERDICTS" ) >/dev/null 2>&1 || true
    local sfile; sfile="$(ls -t "$VERDICTS/$task-"*-codex-security.json 2>/dev/null | head -n 1)"
    sv="CHANGES_REQUIRED"; [ -n "$sfile" ] && sv="$(jq -r '.final_verdict' "$sfile")"
  fi
  git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true

  if [ "$jv" != "APPROVED" ] && [ "$cv" != "APPROVED" ]; then
    fail "$task" "judge=$jv, codex=$cv（両方が差し戻し）"; mv "$req" "$DONE_DIR/"; return
  fi
  # p0.3.1：セキュリティ審査の不合格は、不一致の扱い・オーナーの裁定より先に止める（裁定はセキュリティ審査に効かない。憲法審査の指摘①）
  if [ "$sv" != "SKIPPED" ] && [ "$sv" != "APPROVED" ]; then
    fail "$task" "セキュリティ審査が差し戻し"; mv "$req" "$DONE_DIR/"; return
  fi
  if [ "$NO_CODEX" -eq 0 ] && [ "$jv" != "$cv" ]; then
    # 不一致：critical・major の有無が分かれたら blocked。minor だけなら厳しい側の指摘を票に残して統合（D-47③）
    local jsev csev
    jsev="$(jq -r '[.judge.findings[]? | select(.severity=="critical" or .severity=="major")] | length' "$jfile" 2>/dev/null || echo 0)"
    csev="$(jq -r '[.codex.findings[]? | select(.severity=="critical" or .severity=="major")] | length' "$cfile" 2>/dev/null || echo 0)"
    log_event "disagreement" "$task" "\"judge\":\"$jv\",\"codex\":\"$cv\",\"judge_major\":$jsev,\"codex_major\":$csev"
    if [ "$jsev" -gt 0 ] || [ "$csev" -gt 0 ]; then
      # p0.3.1：オーナーの裁定（Z3 の rulings.jsonl。行政は書けない）が、この票のこの申請の SHA について「統合」なら、理由を記録して進める（D-59①）。
      #   裁定は申請の SHA に結び付く（後から差し替えた申請には効かない）。監査の不合格・セキュリティ審査の不合格・保護パスには効かない
      local ruling; ruling="$(jq -c --arg t "$task" --arg s "$actual" 'select(.task==$t and .sha==$s and .decision=="merge")' "$Z3/evidence/rulings.jsonl" 2>/dev/null | tail -n 1)"
      if [ -n "$ruling" ]; then
        log_event "owner_ruling" "$task" "\"sha\":\"${actual:0:12}\",\"judge\":\"$jv\",\"codex\":\"$cv\",\"ruling\":$ruling"
        printf '\n- %s gate-runner: judge と Codex が分かれたが、オーナーの裁定（統合）により進める：%s\n' "$(ts)" "$(printf '%s' "$ruling" | jq -r '.reason')" >> "$t"
      else
        fail "$task" "judge と Codex の判定が重大な指摘で分かれた（judge=$jv/$jsev 件, codex=$cv/$csev 件）。オーナーの裁定へ" "blocked"; mv "$req" "$DONE_DIR/"; return
      fi
    else
      printf '\n- %s gate-runner: judge と Codex が minor の指摘で分かれた。厳しい側の指摘を残して統合（judge=%s, codex=%s）\n' "$(ts)" "$jv" "$cv" >> "$t"
    fi
  fi

  # p0.3.1：--hold（夜間）では統合しない。合格した候補を Z3 に記録し、朝にオーナーが release.sh で確かめて統合する（約束9・11）
  if [ "$HOLD" -eq 1 ]; then
    git -C "$REPO" update-ref "refs/vgdd/held/$task" "$candidate"   # 候補のコミットを残しておくための参照（中身の照合は Z3 の記録で行う）
    jq -nc --arg ts "$(ts)" --arg t "$task" --arg r "$actual" --arg c "$candidate" --arg m "$main_sha" --arg j "$jv" --arg x "$cv" \
      '{ts:$ts,task:$t,request:$r,candidate:$c,main_at_check:$m,judge:$j,codex:$x}' >> "$Z3/evidence/held.jsonl"
    log_event "held" "$task" "\"request\":\"${actual:0:12}\",\"candidate\":\"${candidate:0:12}\",\"judge\":\"$jv\",\"codex\":\"$cv\""
    set_ticket_status "$task" "review" "判定に合格（judge=$jv codex=$cv）。夜間のため統合せず、朝のオーナーの承認を待つ"
    mv "$req" "$DONE_DIR/"
    echo "  ⏸ $task は合格。朝のオーナーの承認を待つ（候補 ${candidate:0:12}）"
    return
  fi

  # 10 統合（main の checkout。未コミットの変更があれば止める）
  # p0.2.3：同じ実行の中で gate-runner 自身が書いた票（docs/tasks/）の変更は除いて確かめる（OBS-019）
  if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no -- . ':(exclude)docs/tasks')" ]; then
    fail "$task" "main の checkout に未コミットの変更がある。オーナーが片付けてから再申請" "review"; return
  fi
  # p0.3.1 案：統合するのは検査した候補のコミット（$candidate）。候補は段階 2 の時点の main を親に持つので fast-forward になる。
  #   段階 2 以降に main が進んでいれば（同じ周回で別の票が統合された等）ここで止まり、次の周回で最新の main と組み合わせて検査し直す。
  if [ "$(git -C "$REPO" rev-parse main)" != "$main_sha" ]; then
    echo "  ↻ $task: 検査中に main が進んだ。次の周回で最新の main と組み合わせて検査し直す" >&2
    log_event "requeued" "$task" "\"reason\":\"main advanced during inspection\",\"main_at_check\":\"${main_sha:0:12}\""
    return
  fi
  if ! git -C "$REPO" merge --ff-only "$candidate" >/dev/null 2>&1; then
    fail "$task" "fast-forward できない（想定外。候補 ${candidate:0:12} が main を親に持たない）"; mv "$req" "$DONE_DIR/"; return
  fi
  local merged; merged="$(git -C "$REPO" rev-parse --short=12 HEAD)"
  set_ticket_status "$task" "merged" "main=$merged judge=$jv codex=$cv"
  log_event "merged" "$task" "\"main\":\"$merged\",\"judge\":\"$jv\",\"codex\":\"$cv\""
  update_board
  # p0.2.3：記録のコミットは1回の処理の最後にまとめる。ここでコミットすると main が進み、
  # 鎖で申請された次の票が「main を含まない」で止まるため（OBS-019）
  RUN_MERGED="${RUN_MERGED}${task}($jv/$cv) "
  mv "$req" "$DONE_DIR/"
  echo "  ✓ $task を統合: main=$merged"
}

echo "gate-runner 起動: repo=$REPO interval=${INTERVAL}s codex=$([ "$NO_CODEX" -eq 1 ] && echo off || echo on)"
while :; do
  check_git_config
  shopt -s nullglob
  for req in "$REQ_DIR"/*.json; do
    process_request "$req" || echo "  ! $req の処理で例外" >&2
  done
  shopt -u nullglob
  # p0.2.3：この回の記録（統合・差し戻し）を1つのコミットにまとめる
  if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no -- docs/tasks)" ]; then
    git -C "$REPO" add "docs/tasks/" && git -C "$REPO" -c user.name=gate-runner -c user.email=gate-runner@local commit -q \
      -m "gate-runner: 記録（統合: ${RUN_MERGED:-なし}）" || true
  fi
  RUN_MERGED=""
  # p0.3.0：証拠ストアのチェックポイント（件数と末尾の行のハッシュ）。末尾の切り詰めを verify-chain で検出する（D-56③）
  for lf in "$Z3/evidence/tool_calls.jsonl" "$EVENTS"; do
    [ -s "$lf" ] || continue
    printf '{"ts":"%s","file":"%s","count":%s,"last_sha256":"%s"}\n' "$(ts)" "$(basename "$lf")" "$(wc -l < "$lf" | tr -d ' ')" "$(tail -n 1 "$lf" | tr -d '\n' | shasum -a 256 | cut -c1-64)" >> "$Z3/evidence/checkpoints.jsonl"
  done
  # 事後検知：自分以外のコミットで main が進んでいないか（直接統合の違反の検知）
  LAST_MAIN_FILE="$Z3/evidence/.last_main"
  cur="$(git -C "$REPO" rev-parse HEAD)"
  if [ -f "$LAST_MAIN_FILE" ] && [ "$(cat "$LAST_MAIN_FILE")" != "$cur" ]; then
    author="$(git -C "$REPO" log -1 --format=%an "$cur")"
    [ "$author" = "gate-runner" ] || log_event "main_advanced_outside_gate" "-" "\"head\":\"${cur:0:12}\",\"author\":$(jq -Rn --arg a "$author" '$a')"
  fi
  echo "$cur" > "$LAST_MAIN_FILE"
  [ "$ONCE" -eq 1 ] && break
  sleep "$INTERVAL"
done
