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
#   2 ブランチが main を含む（rebase 済み）
#   3 差分が票の files_allowed の中だけ。保護パスが含まれていれば即拒否
#   4 秘密情報らしい文字列・実名の形がない
#   5 一時 worktree で npm ci → npm test → typecheck → lint
#   6 judge.sh（Claude）→ 7 judge-codex.sh（Codex）→ 8 不一致の扱い（critical・major が分かれたら blocked）
#   9 security_review の票は judge-codex.sh --security も
#  10 合格なら main で git merge --ff-only → 票を merged に、§6 に記録、_board.json を更新、申請を done/ に移す
#
# 前提: jq、node、npm、codex（--no-codex でなければ）。main の checkout に未コミットの変更がないこと。

set -euo pipefail

REPO="${HOME}/tsubuyaki-worklog/app"; INTERVAL=30; ONCE=0; NO_CODEX=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --interval) INTERVAL="$2"; shift 2;;
    --once) ONCE=1; shift;;
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
  [[ "$actual" == "$sha"* ]] || { fail "$task" "申請の HEAD（$sha）とブランチの HEAD（${actual:0:12}）が違う"; mv "$req" "$DONE_DIR/"; return; }
  local returns; returns="$(grep -c 'gate-runner: status → in_progress' "$t" || true)"
  [ "$returns" -lt "$MAX_RETURNS" ] || { fail "$task" "差し戻しが $MAX_RETURNS 回に達した。オーナーの判断へ" "blocked"; mv "$req" "$DONE_DIR/"; return; }

  # 2 rebase 済み
  git -C "$REPO" merge-base --is-ancestor main "$branch" || { fail "$task" "ブランチが main を含んでいない（rebase が必要）"; mv "$req" "$DONE_DIR/"; return; }

  # 3 差分の範囲
  local changed; changed="$(git -C "$REPO" diff --name-only "main...$branch")"
  if printf '%s\n' "$changed" | grep -Eq "$PROTECTED_RE"; then
    fail "$task" "保護パスへの変更が含まれている: $(printf '%s\n' "$changed" | grep -E "$PROTECTED_RE" | tr '\n' ' ')" "blocked"; mv "$req" "$DONE_DIR/"; return
  fi
  local allowed; allowed="$(front_list "$t" files_allowed)"
  local outside=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    local okf=0
    while IFS= read -r a; do [ -n "$a" ] && [[ "$f" == $a ]] && okf=1; done <<< "$allowed"
    [ "$okf" -eq 1 ] || outside="$outside $f"
  done <<< "$changed"
  [ -z "$outside" ] || { fail "$task" "files_allowed の外を変更している:$outside"; mv "$req" "$DONE_DIR/"; return; }

  # 4 秘密情報・実名
  if git -C "$REPO" diff "main...$branch" | grep -nE 'sk-ant-api03-[A-Za-z0-9]{40,}|BEGIN (RSA|OPENSSH|PRIVATE)|@gmail\.com|password *=|AKIA[0-9A-Z]{16}' >/dev/null; then
    fail "$task" "秘密情報らしい文字列が差分にある" "blocked"; mv "$req" "$DONE_DIR/"; return
  fi
  if [ -f "$Z3/eval/banned-terms.txt" ] && git -C "$REPO" diff "main...$branch" | grep -nFf "$Z3/eval/banned-terms.txt" >/dev/null; then
    fail "$task" "実案件・実名の語が差分にある（Z3 の一覧に一致）" "blocked"; mv "$req" "$DONE_DIR/"; return
  fi

  # 5 決定論的な監査（一時 worktree）
  local wt; wt="$(mktemp -d "${TMPDIR:-/tmp}/gate-$task-XXXX")"
  git -C "$REPO" worktree add --detach "$wt" "$branch" >/dev/null 2>&1
  local audit_ok=1
  ( cd "$wt" && npm ci --no-fund --no-audit >/dev/null 2>&1 && npm run -s test >/dev/null 2>&1 && npm run -s typecheck >/dev/null 2>&1 && npm run -s lint >/dev/null 2>&1 ) || audit_ok=0
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
  git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true

  if [ "$jv" != "APPROVED" ] && [ "$cv" != "APPROVED" ]; then
    fail "$task" "judge=$jv, codex=$cv（両方が差し戻し）"; mv "$req" "$DONE_DIR/"; return
  fi
  if [ "$NO_CODEX" -eq 0 ] && [ "$jv" != "$cv" ]; then
    # 不一致：critical・major の有無が分かれたら blocked。minor だけなら厳しい側の指摘を票に残して統合（D-47③）
    local jsev csev
    jsev="$(jq -r '[.judge.findings[]? | select(.severity=="critical" or .severity=="major")] | length' "$jfile" 2>/dev/null || echo 0)"
    csev="$(jq -r '[.codex.findings[]? | select(.severity=="critical" or .severity=="major")] | length' "$cfile" 2>/dev/null || echo 0)"
    log_event "disagreement" "$task" "\"judge\":\"$jv\",\"codex\":\"$cv\",\"judge_major\":$jsev,\"codex_major\":$csev"
    if [ "$jsev" -gt 0 ] || [ "$csev" -gt 0 ]; then
      fail "$task" "judge と Codex の判定が重大な指摘で分かれた（judge=$jv/$jsev 件, codex=$cv/$csev 件）。オーナーの裁定へ" "blocked"; mv "$req" "$DONE_DIR/"; return
    fi
    printf '\n- %s gate-runner: judge と Codex が minor の指摘で分かれた。厳しい側の指摘を残して統合（judge=%s, codex=%s）\n' "$(ts)" "$jv" "$cv" >> "$t"
  fi
  if [ "$(front "$t" security_review)" = "true" ] && [ "$NO_CODEX" -eq 0 ]; then
    local wt2; wt2="$(mktemp -d "${TMPDIR:-/tmp}/gate-sec-$task-XXXX")"; git -C "$REPO" worktree add --detach "$wt2" "$branch" >/dev/null 2>&1
    ( cd "$wt2" && "$BIN/judge-codex.sh" --security "${reqargs[@]}" --base main --task "$task" --out "$VERDICTS" ) >/dev/null 2>&1 || true
    git -C "$REPO" worktree remove --force "$wt2" >/dev/null 2>&1 || true
    local sfile; sfile="$(ls -t "$VERDICTS/$task-"*-codex-security.json 2>/dev/null | head -n 1)"
    [ -n "$sfile" ] && [ "$(jq -r '.final_verdict' "$sfile")" = "APPROVED" ] || { fail "$task" "セキュリティ審査が差し戻し"; mv "$req" "$DONE_DIR/"; return; }
  fi

  # 10 統合（main の checkout。未コミットの変更があれば止める）
  if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; then
    fail "$task" "main の checkout に未コミットの変更がある。オーナーが片付けてから再申請" "review"; return
  fi
  if ! git -C "$REPO" merge --ff-only "$branch" >/dev/null 2>&1; then
    fail "$task" "fast-forward できない（main が進んだ）。rebase が必要"; mv "$req" "$DONE_DIR/"; return
  fi
  local merged; merged="$(git -C "$REPO" rev-parse --short=12 HEAD)"
  set_ticket_status "$task" "merged" "main=$merged judge=$jv codex=$cv"
  log_event "merged" "$task" "\"main\":\"$merged\",\"judge\":\"$jv\",\"codex\":\"$cv\""
  update_board
  git -C "$REPO" add "docs/tasks/" && git -C "$REPO" -c user.name=gate-runner -c user.email=gate-runner@local commit -q -m "gate-runner: $task を統合（judge=$jv, codex=$cv）" || true
  mv "$req" "$DONE_DIR/"
  echo "  ✓ $task を統合: main=$merged"
}

echo "gate-runner 起動: repo=$REPO interval=${INTERVAL}s codex=$([ "$NO_CODEX" -eq 1 ] && echo off || echo on)"
while :; do
  shopt -s nullglob
  for req in "$REQ_DIR"/*.json; do
    process_request "$req" || echo "  ! $req の処理で例外" >&2
  done
  shopt -u nullglob
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
