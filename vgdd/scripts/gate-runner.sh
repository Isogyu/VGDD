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
#   1 申請と票の整合（status: review、HEAD が一致）。p0.4.0：main の票の仕様がオーナーに承認されている（spec-digest.mjs）
#   （Kernel の停止中＝Z3 に STOP があるあいだは、申請を処理しない。p0.4.0）
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
  # p0.4.7（OBS-060）：止まる前に証拠ストアに記録を残す（記録がないと、止まったことが外から分からない）。中身は種類だけ（設定の本文・ハッシュは残さない）
  if [ ! -f "$base" ]; then log_event "git_config_changed" "-" '"kind":"baseline_missing"'; echo "git の設定の基準値がない（${base}）。オーナーが vgdd/scripts/git-baseline.sh で作る（fail-closed）" >&2; exit 70; fi
  [ "$cur" = "$(cat "$base")" ] || { log_event "git_config_changed" "-" '"kind":"mismatch"'; echo "共有の .git/config が基準値から変わっている。オーナーが確かめるまで止める（fail-closed。OBS-033）" >&2; exit 70; }
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
# p0.4.6：監査の sandbox（sandboxed-run.sh）は VGDD_REPO の .env.local を読ませない。--repo の値を渡す（既定と違う場所で使うと、
#   p0.4.5 までは対象のリポジトリの .env.local が監査中のコードから読めた。行政の長の報告）
REPO="$(CDPATH= cd -- "$REPO" 2>/dev/null && pwd -P)" || { echo "--repo のフォルダがない" >&2; exit 64; }   # 起動の時点で絶対・正規化したパスに（相対パスで渡されても、監査の作業場所で解決しない。Codex の監査 p0.4.6 #1）
export VGDD_REPO="$REPO"
VERDICTS="$Z3/evidence/verdicts"
EVENTS="$Z3/evidence/gate_events.jsonl"
BIN="$Z3/bin"                      # judge.sh / judge-codex.sh の実行用コピーもここに置く
REQ_DIR="$REPO/merge-requests"
DONE_DIR="$REQ_DIR/done"
BOARD="$REPO/docs/tasks/_board.json"
PROTECTED_RE='^(\.claude/|CLAUDE\.md$|\.github/|vgdd/|docs/requirements\.md$|docs/tasks/_board\.json$|docs/governance/|merge-requests/)'
MAX_RETURNS=3                       # 差し戻しの上限（D-05）

mkdir -p "$VERDICTS" "$DONE_DIR"

ts() { date +%Y-%m-%dT%H:%M:%S%z; }
log_event() { # type, task, json-extra
  printf '{"ts":"%s","type":"%s","task":"%s",%s}\n' "$(ts)" "$1" "$2" "$3" >> "$EVENTS"
}
fail() { # task, reason, new_status → 票に書きかけがあれば何も記録せず 1（呼び出し側は申請を done に移さない。p0.4.2）
  local task="$1" reason="$2" status="${3:-in_progress}"
  local ft; ft="$(ticket_path "$task")"
  if [ -n "$ft" ] && ticket_dirty "docs/tasks/$(basename "$ft")"; then dirty_wait "$task" "docs/tasks/$(basename "$ft")"; return 1; fi
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
RUN_TOUCHED=""   # p0.4.0：この周回で gate-runner 自身が書き換えた票（記録のコミットはこれだけに限る。OBS-044）
ticket_dirty() { # rel → 0（真）＝ほかの誰かのコミットしていない変更が票にある。この周回に自分が書いた票は自分の変更として除く
  case " $RUN_TOUCHED " in *" $1 "*) return 1;; esac
  # 未追跡の票も書きかけとみなす。git status が失敗したら書きかけとみなす（fail-closed。Codex の指摘 p0.4.2c #1）
  local st; st="$(git -C "$REPO" status --porcelain --untracked-files=all -- "$1" 2>/dev/null)" || return 0
  [ -n "$st" ]
}
dirty_wait() { # task, rel：書きかけのある票の申請は処理しない（判定も記録も統合もせず、申請を残す）
  # p0.4.2（OBS-050）：p0.4.0 までは記録だけして票を書き換え、書きかけが gate-runner の名前で main に入った。
  #   預けて後で書く案・main に隔離してコミットする案は、票と記録が2つの状態に分かれる（Codex の監査 2回、major 18件）ため採らない。
  #   書きかけがコミットされるか戻されれば、次の周回で普通に処理する。出来事の task は "-"（夜間ランナーの wait_gate は票ごとの最後の出来事を読む）
  log_event "ticket_dirty_wait" "-" "\"ticket\":\"$2\",\"for\":\"$1\""
  echo "  ⏳ ${1}: 票（$2）にコミットしていない変更がある。申請は残し、次の周回で処理する" >&2
}
ticket_edit() { # task, status（空なら変えない）, 行（§6 に足す1行。先頭の「- 」は付けない）→ 書きかけのある票なら書かずに 1
  local t; t="$(ticket_path "$1")"; [ -n "$t" ] || return 0
  local rel="docs/tasks/$(basename "$t")"
  if ticket_dirty "$rel"; then dirty_wait "$1" "$rel"; return 1; fi
  case " $RUN_TOUCHED " in *" $rel "*) ;; *) RUN_TOUCHED="$RUN_TOUCHED $rel";; esac
  [ -z "$2" ] || sed -i '' -E "s/^status: .*/status: $2/" "$t"
  printf '\n- %s\n' "$3" >> "$t"
}
set_ticket_status() { # task, status, note
  ticket_edit "$1" "$2" "$(ts) gate-runner: status → $2${3:+（$3）}"
}
verdict_of() { # file → APPROVED | CHANGES_REQUIRED | UNAVAILABLE
  # p0.4.3：次はどれも「司法が使えない」（判定ではない）：ファイルがない・空・ファイル全体が1つの JSON オブジェクトでない（jq が失敗すれば
  #   途中まで出た値も捨てる。Codex の指摘 #2）・結論が2つのどちらでもない・司法の出力を解釈できなかった（judge.sh の judge_parse_ok、
  #   judge-codex.sh の parse_ok が false。CLI の空の応答・認証切れ・利用の上限。p0.4.2 では CHANGES_REQUIRED・指摘0件として数え、
  #   もう一方が APPROVED なら minor の不一致として統合された。Codex の指摘 #1 critical）
  local v=""
  local flag="judge_parse_ok"; case "$1" in *-codex-*) flag="parse_ok";; esac   # 成り立ったことの印は true の真偽が必須（欠けも使えない。Codex の3回目の監査 #1）
  [ -s "$1" ] && v="$(jq -s -r --arg k "$flag" 'if length == 1 and (.[0] | type) == "object" and (.[0][$k] == true) then (.[0].final_verdict // "") else "" end' "$1" 2>/dev/null)" || v=""
  case "$v" in APPROVED|CHANGES_REQUIRED) echo "$v";; *) echo "UNAVAILABLE";; esac
}
JUDICIARY_MAX_FAILS=3               # p0.4.3：同じ申請の SHA で司法が使えなかった回数の上限。超えたらオーナーの判断へ（blocked）
judiciary_unavailable() { # task, 申請の完全な SHA, どの司法か, 申請のファイル
  # p0.4.3（OBS-053）：司法が使えないことは判定ではない。票を書き換えず（差し戻しの回数を使わず）、申請を残して次の周回でやり直す。
  #   行政が司法を壊す入力で裁判所を待たせ続けないよう、同じ申請の SHA で通算 JUDICIARY_MAX_FAILS 回に達したら blocked にする
  #   回数は同じ申請の完全な SHA での通算（間に判定が成り立った周回があっても戻さない。Codex の指摘 #5 を受け SPEC も「通算」に）
  local ft rel; ft="$(ticket_path "$1")"; rel="docs/tasks/$(basename "$ft")"
  if [ -n "$ft" ] && ticket_dirty "$rel"; then dirty_wait "$1" "$rel"; return 0; fi
  local n; n="$(jq -c --arg t "$1" --arg s "$2" 'select(.type=="judiciary_unavailable" and .task==$t and .request_full==$s)' "$EVENTS" 2>/dev/null | wc -l | tr -d ' ')"
  n=$((n + 1))
  log_event "judiciary_unavailable" "$1" "\"request\":\"${2:0:12}\",\"request_full\":\"$2\",\"which\":\"$3\",\"count\":$n"
  echo "  ⚠ ${1}: 司法（$3）が使えなかった（判定の記録がない・読めない・出力を解釈できない。この申請で通算 ${n} 回目）。差し戻しに数えず、申請を残す" >&2
  if [ "$n" -ge "$JUDICIARY_MAX_FAILS" ]; then
    # 差し戻し（rejected）として記録しない（盤の returns と上限に数えない。Codex の指摘 #6）。票の記録に成功したときだけ申請を移す
    set_ticket_status "$1" "blocked" "司法（$3）が同じ申請で通算 ${n} 回使えなかった。差し戻しではない。オーナーが司法の環境を確かめてから再申請する" || return 0
    log_event "judiciary_blocked" "$1" "\"request\":\"${2:0:12}\",\"which\":\"$3\",\"count\":$n"
    mv "$4" "$DONE_DIR/"
  fi
  return 0
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
  echo "▶ ${task}（$branch @ ${sha}）"
  # p0.4.0：この申請の処理は、ここで取った main の完全な SHA に固定する（仕様の照合・差分・候補・司法・統合のすべて）。
  #   照合の後に行政が未承認の仕様を main にコミットしても、その main では検査しない（Codex の指摘 #4。確認と使用の時刻の差）
  local main_sha; main_sha="$(git -C "$REPO" rev-parse main)"
  local t; t="$(ticket_path "$task")"
  [ -n "$t" ] || { fail "$task" "票が見つからない" "blocked" && mv "$req" "$DONE_DIR/"; return; }
  # p0.4.2（OBS-050）：票にほかの誰かの書きかけがあれば、この申請は処理しない（判定の費用も使わない）
  if ticket_dirty "docs/tasks/$(basename "$t")"; then dirty_wait "$task" "docs/tasks/$(basename "$t")"; return; fi

  # 1 整合
  [ "$(front "$t" status)" = "review" ] || { fail "$task" "票の status が review ではない（$(front "$t" status)）" && mv "$req" "$DONE_DIR/"; return; }
  # p0.2.1（OBS-015②）：基盤の票は main にコミット済みの票の requirements_source を見る。作業ツリーの票だけが ticket なら差し戻す
  trel="docs/tasks/$(basename "$t")"
  src_main="$(git -C "$REPO" show "$main_sha:$trel" 2>/dev/null | sed -n '/^---$/,/^---$/p' | sed -n 's/^requirements_source: *//p' | head -n 1 | sed 's/ *#.*$//' | tr -d ' ')"
  if [ "$(front "$t" requirements_source)" = "ticket" ] && [ "$src_main" != "ticket" ]; then
    fail "$task" "基盤の票（requirements_source: ticket）が main にコミットされていない、または main の票と違う。票は作業前に main にコミットする" "blocked" && mv "$req" "$DONE_DIR/"; return
  fi
  # p0.4.0：仕様の承認（Governance Kernel の Approval Gate。ADR-005・成立条件②）。main の票の仕様（統治の項目と受け入れ条件）の指紋が、
  #   オーナーの承認の記録（Z3 の spec_approvals.jsonl。行政は書けない）と合わなければ、判定も統合もしない。承認は approve-spec.sh
  if ! node "$BIN/spec-digest.mjs" --repo "$REPO" --ref "$main_sha" --ticket "$trel" --check "$Z3/evidence/spec_approvals.jsonl" >/dev/null 2>&1; then
    fail "$task" "仕様（main の票の統治の項目と受け入れ条件）がオーナーに承認されていない、または承認の後に変わった。approve-spec.sh で承認する" "blocked" && mv "$req" "$DONE_DIR/"; return
  fi
  git -C "$REPO" rev-parse --verify -q "$branch" >/dev/null || { fail "$task" "ブランチ $branch がない" "blocked" && mv "$req" "$DONE_DIR/"; return; }
  local actual; actual="$(git -C "$REPO" rev-parse "$branch")"
  # p0.3.0：以後の検査・判定・統合は、この完全な SHA（${actual}）に固定する。ブランチ名は使わない（OBS-023②）
  [[ "$actual" == "$sha"* ]] || { fail "$task" "申請の HEAD（${sha}）とブランチの HEAD（${actual:0:12}）が違う" && mv "$req" "$DONE_DIR/"; return; }
  # p0.4.7：数えるのは「## 6. 記録」の見出しから後ろの、裁判所の記録の行の形（- <時刻> gate-runner: status → in_progress）だけ。
  #   票の説明や引用の中の同じ文字列は数えない（Codex の監査 p0.4.7 #2）。見出しから後ろを全部見るのは、裁判所が票の末尾に書き足すため
  local returns; returns="$(awk '/^## 6\. 記録[ \t]*$/{s=1;next} s && /^- [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9][+-][0-9][0-9][0-9][0-9] gate-runner: status → in_progress/{n++} END{print n+0}' "$t")"
  # p0.4.7：Z3 の裁判所の出来事（rejected・status in_progress）でも数え、多い方を使う。行政は main の票の §6 を書けるが Z3 は書けないので、
  #   §6 の行を消しても回数は減らない（オーナーの指摘。11/7 時点の 32 票で、両方の数は一致した）
  #   集計は1つの jq で行い、失敗・読めない行・数でない出力のどれでも 0 にせず、申請を残して処理しない（fail-closed。Codex の監査 p0.4.7c）
  local ev_returns=0
  if [ -f "$EVENTS" ]; then
    ev_returns="$(jq -Rn --arg t "$task" '[inputs | (fromjson? // "BROKEN")] | if any(. == "BROKEN") then error("broken") else map(objects | select(.type == "rejected" and .task == $t and .status == "in_progress")) | length end' "$EVENTS" 2>/dev/null)" || ev_returns=""
    if ! [[ "$ev_returns" =~ ^[0-9]+$ ]]; then
      log_event "returns_uncountable" "$task" '"source":"gate_events"'; return
    fi
  fi
  [ "$ev_returns" -le "$returns" ] || returns="$ev_returns"
  # p0.2.4：オーナーが取り消した差し戻し（法律の不具合・鎖の連鎖によるもの）は数えない。取り消しの記録は Z3 にあり、行政は書けない（OBS-020）
  #   p0.4.7：取り消しの記録は JSON として読む（空白の有無で数が変わらない。読めない行は数えない。Codex の監査 p0.4.7 #1）。1行＝1回の取り消し
  local annulled=0; [ -f "$Z3/evidence/annulments.jsonl" ] && annulled="$(jq -R --arg t "$task" 'fromjson? | objects | select(.task == $t)' "$Z3/evidence/annulments.jsonl" 2>/dev/null | jq -s 'length' 2>/dev/null || echo 0)"; annulled="${annulled:-0}"
  returns=$(( returns - annulled )); [ "$returns" -ge 0 ] || returns=0
  [ "$returns" -lt "$MAX_RETURNS" ] || { fail "$task" "差し戻しが $MAX_RETURNS 回に達した。オーナーの判断へ" "blocked" && mv "$req" "$DONE_DIR/"; return; }

  # 2 統合キュー（p0.3.1 案、D-55③）：ブランチが main を含んでいなくても差し戻さない。
  #   一時 worktree で「最新の main に申請の SHA を merge した候補のコミット」を作り、以後の検査・判定（3〜9）と統合（10）は
  #   その候補に対して行う。候補は main を親に持つので、統合は常に fast-forward（検査した木＝統合される木。p0.3.0 の SHA の固定は保つ）。
  #   衝突すれば needs_rebase で差し戻す。鎖で積まなくてよく、前の票が止まっても後ろの票は止まらない（OBS-019・OBS-024 の連鎖の解消）。
  #   p0.2.4 の「記録のコミットだけ遅れている」場合もこの経路で吸収する。
  local candidate="$actual"
  local wt; wt="$(mktemp -d "${TMPDIR:-/tmp}/gate-$task-XXXX")"
  if git -C "$REPO" merge-base --is-ancestor "$main_sha" "$actual"; then
    git -C "$REPO" worktree add --detach "$wt" "$actual" >/dev/null 2>&1
  else
    git -C "$REPO" worktree add --detach "$wt" "$main_sha" >/dev/null 2>&1
    if ! git -C "$wt" -c user.name=gate-runner -c user.email=gate-runner@local merge --no-ff --no-edit -q \
         -m "gate-runner: $task を main ${main_sha:0:12} と組み合わせた候補（申請 ${actual:0:12}）" "$actual" >/dev/null 2>&1; then
      git -C "$wt" merge --abort >/dev/null 2>&1 || true
      git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
      fail "$task" "main と衝突する（needs_rebase。files_allowed が重なる票が先に統合された可能性）" && mv "$req" "$DONE_DIR/"; return
    fi
    candidate="$(git -C "$wt" rev-parse HEAD)"
    log_event "candidate" "$task" "\"request\":\"${actual:0:12}\",\"main\":\"${main_sha:0:12}\",\"candidate\":\"${candidate:0:12}\""
  fi
  # 以後、差分の範囲（3・4）は申請の SHA の変更分（main...${actual}）で見る。監査・判定・統合は候補の木（${wt}、${candidate}）で行う

  # 3 差分の範囲
  local changed; changed="$(git -C "$REPO" diff --name-only "$main_sha...$actual")"
  if printf '%s\n' "$changed" | grep -Eq "$PROTECTED_RE"; then
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "$task" "保護パスへの変更が含まれている: $(printf '%s\n' "$changed" | grep -E "$PROTECTED_RE" | tr '\n' ' ')" "blocked" && mv "$req" "$DONE_DIR/"; return
  fi
  # p0.4.0：files_allowed・security_review・requirements は main にコミットされた票（承認した仕様）から読む。
  #   作業ツリーの票は行政の長がコミットせずに書き換えられるため、統治の項目には使わない（status と §6 の記録は作業ツリーで扱う）
  local tmain="${TMPDIR:-/tmp}/gate-ticket-$$.md"; git -C "$REPO" show "$main_sha:$trel" > "$tmain"   # 申請ごとに上書き
  local allowed; allowed="$(front_list "$tmain" files_allowed)"
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
  [ -z "$outside" ] || { git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true; fail "$task" "files_allowed の外を変更している:$outside" && mv "$req" "$DONE_DIR/"; return; }

  # 4 秘密情報・実名
  if git -C "$REPO" diff "$main_sha...$actual" | grep -nE 'sk-ant-api03-[A-Za-z0-9]{40,}|BEGIN (RSA|OPENSSH|PRIVATE)|@gmail\.com|password *=|AKIA[0-9A-Z]{16}' >/dev/null; then
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "$task" "秘密情報らしい文字列が差分にある" "blocked" && mv "$req" "$DONE_DIR/"; return
  fi
  if [ -f "$Z3/eval/banned-terms.txt" ] && git -C "$REPO" diff "$main_sha...$actual" | grep -nFf "$Z3/eval/banned-terms.txt" >/dev/null; then
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "$task" "実案件・実名の語が差分にある（Z3 の一覧に一致）" "blocked" && mv "$req" "$DONE_DIR/"; return
  fi

  # 5 決定論的な監査（段階 2 で作った一時 worktree ＝ 候補の木）
  local audit_ok=1
  # p0.3.0：作業員の書いたコード（テスト・設定・npm のスクリプト）は sandbox-exec の中で実行する（OBS-023①）。
  # 書き込みは一時 worktree と一時領域だけ、Z3・.env.local は読めない、テストの間はネットワークなし
  local SBX="$BIN/sandboxed-run.sh"
  [ -x "$SBX" ] || { git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true; fail "$task" "sandboxed-run.sh がない（fail-closed）" "blocked" && mv "$req" "$DONE_DIR/"; return; }
  ( cd "$wt" && "$SBX" --dir "$wt" --net -- npm ci --no-fund --no-audit >/dev/null 2>&1 \
      && "$SBX" --dir "$wt" -- npm run -s test >/dev/null 2>&1 \
      && "$SBX" --dir "$wt" -- npm run -s typecheck >/dev/null 2>&1 \
      && "$SBX" --dir "$wt" -- npm run -s lint >/dev/null 2>&1 ) || audit_ok=0
  if [ "$audit_ok" -ne 1 ]; then
    git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
    fail "$task" "決定論的な監査（test/typecheck/lint）が不合格" && mv "$req" "$DONE_DIR/"; return
  fi

  # 6〜9 司法（Claude judge → Codex judge → 不一致 → セキュリティ）
  reqs="$(front_list "$tmain" requirements | tr '\n' ',' | sed 's/,$//')"
  [ -n "$reqs" ] || reqs="$(front "$tmain" requirements | tr -d '[]' | tr -d ' ')"
  # p0.2.1：基盤の票（requirements_source: ticket）は、docs/requirements.md ではなく票の受け入れ条件を要件として渡す（--ticket）。
  #   judge.sh は main にコミット済みの票（git show main:docs/tasks/…）から節と「- A1.」… の ID を読み、ブランチの票と違えば fail-closed（OBS-015②）
  local -a reqargs
  if [ "$src_main" = "ticket" ]; then reqargs=(--ticket "$trel"); else reqargs=(--req "$reqs"); fi
  # p0.4.3（OBS-053・Max の点検 §9-3）：判定のファイルは、この候補の SHA（judge.sh・judge-codex.sh が HEAD の先頭12桁で名付ける）のものだけを読む。
  #   p0.4.2 までは「この票の最新のファイル」を読んでおり、(a) Codex がファイルを書かずに終われば cv=SKIPPED のまま、judge が APPROVED なら
  #   minor の不一致として統合された (b) 司法がファイルを書かずに終われば、前の申請の判定が使われえた。
  #   ファイルがない・結論が APPROVED／CHANGES_REQUIRED でないことは「司法が使えない」であって判定ではない（差し戻しに数えず、申請を残す）
  local c12="${candidate:0:12}"
  local jfile="$VERDICTS/$task-$c12.json" cfile="$VERDICTS/$task-$c12-codex-judge.json" sfile="$VERDICTS/$task-$c12-codex-security.json"
  rm -f "$jfile" "$cfile" "$sfile"   # 同じ候補の前回の判定（司法が使えなかった周回の残り）を読まない
  ( cd "$wt" && "$BIN/judge.sh" "${reqargs[@]}" --base "$main_sha" --task "$task" --out "$VERDICTS" ) >/dev/null 2>&1 || true
  local jv; jv="$(verdict_of "$jfile")"
  local cv="SKIPPED"
  if [ "$NO_CODEX" -eq 0 ] && [ "$jv" != "UNAVAILABLE" ]; then
    ( cd "$wt" && "$BIN/judge-codex.sh" "${reqargs[@]}" --base "$main_sha" --task "$task" --out "$VERDICTS" ) >/dev/null 2>&1 || true
    cv="$(verdict_of "$cfile")"
  fi
  # p0.3.0a：セキュリティ審査は、監査を済ませた同じ一時 worktree（同じ SHA、node_modules あり）で行う。
  #   別の worktree を作ると依存がなく、審査の中の監査が「vitest が見つからない」で落ちていた（OBS-025）
  local sv="SKIPPED"
  if [ "$(front "$tmain" security_review)" = "true" ] && [ "$NO_CODEX" -eq 0 ] && [ "$jv" != "UNAVAILABLE" ] && [ "$cv" != "UNAVAILABLE" ]; then
    ( cd "$wt" && "$BIN/judge-codex.sh" --security "${reqargs[@]}" --base "$main_sha" --task "$task" --out "$VERDICTS" ) >/dev/null 2>&1 || true
    sv="$(verdict_of "$sfile")"
  fi
  git -C "$REPO" worktree remove --force "$wt" >/dev/null 2>&1 || true
  local which=""
  [ "$jv" != "UNAVAILABLE" ] || which="judge"; [ "$cv" != "UNAVAILABLE" ] || which="codex"; [ "$sv" != "UNAVAILABLE" ] || which="security"
  if [ -n "$which" ]; then judiciary_unavailable "$task" "$actual" "$which" "$req"; return; fi

  if [ "$jv" != "APPROVED" ] && [ "$cv" != "APPROVED" ]; then
    fail "$task" "judge=$jv, codex=${cv}（両方が差し戻し）" && mv "$req" "$DONE_DIR/"; return
  fi
  # p0.3.1：セキュリティ審査の不合格は、不一致の扱い・オーナーの裁定より先に止める（裁定はセキュリティ審査に効かない。憲法審査の指摘①）
  if [ "$sv" != "SKIPPED" ] && [ "$sv" != "APPROVED" ]; then
    fail "$task" "セキュリティ審査が差し戻し" && mv "$req" "$DONE_DIR/"; return
  fi
  HELD_MAJORS="0/0"; local route="agreed"   # p0.4.3：held の記録に通り方を残す（agreed・minor_disagreement・ruling。release が確かめる。Codex の3回目の監査 #2）
  if [ "$NO_CODEX" -eq 0 ] && [ "$jv" != "$cv" ]; then
    # p0.4.2：不一致・裁定の記録の前に書きかけを確かめる（待つなら何も記録しない。Codex の指摘 p0.4.2c #3）
    if ticket_dirty "docs/tasks/$(basename "$t")"; then dirty_wait "$task" "docs/tasks/$(basename "$t")"; return; fi
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
        route="ruling"
        log_event "owner_ruling" "$task" "\"sha\":\"${actual:0:12}\",\"judge\":\"$jv\",\"codex\":\"$cv\",\"ruling\":$ruling"
        ticket_edit "$task" "" "$(ts) gate-runner: judge と Codex が分かれたが、オーナーの裁定（統合）により進める：$(printf '%s' "$ruling" | jq -r '.reason')"   || return   # p0.4.2：書きかけがあれば申請を残して戻る（Codex の指摘 #1）
      else
        fail "$task" "judge と Codex の判定が重大な指摘で分かれた（judge=$jv/$jsev 件, codex=$cv/$csev 件）。オーナーの裁定へ" "blocked" && mv "$req" "$DONE_DIR/"; return
      fi
    else
      route="minor_disagreement"; HELD_MAJORS="$jsev/$csev"
      ticket_edit "$task" "" "$(ts) gate-runner: judge と Codex が minor の指摘で分かれた。厳しい側の指摘を残して統合（judge=${jv}, codex=${cv}）" || return
    fi
  fi

  # p0.4.0：不可逆な操作（held の記録・統合）の直前に、停止と main の前進を確かめ直す（Codex の指摘 #4・#6）。
  #   停止していれば申請を残して戻る。main が進んでいれば、次の周回で最新の main と組み合わせて検査し直す
  if [ -f "$Z3/STOP" ]; then echo "  ⏹ ${task}: 判定の間に Kernel が停止した。申請は残す"; return; fi
  if ticket_dirty "docs/tasks/$(basename "$t")"; then dirty_wait "$task" "docs/tasks/$(basename "$t")"; return; fi   # p0.4.2：判定の間に書きかけが生じた
  if [ "$(git -C "$REPO" rev-parse main)" != "$main_sha" ]; then
    echo "  ↻ ${task}: 検査中に main が進んだ。次の周回で検査し直す" >&2
    log_event "requeued" "$task" "\"reason\":\"main advanced during inspection\",\"main_at_check\":\"${main_sha:0:12}\""
    return
  fi
  # p0.3.1：--hold（夜間）では統合しない。合格した候補を Z3 に記録し、朝にオーナーが release.sh で確かめて統合する（約束9・11）
  if [ "$HOLD" -eq 1 ]; then
    git -C "$REPO" update-ref "refs/vgdd/held/$task" "$candidate"   # 候補のコミットを残しておくための参照（中身の照合は Z3 の記録で行う）
    # p0.4.2：票の記録に成功したときだけ held を確定し、申請を移す（書きかけが生じていれば申請を残す。Codex の指摘 p0.4.2c #2）
    set_ticket_status "$task" "review" "判定に合格（judge=$jv codex=${cv}）。夜間のため統合せず、朝のオーナーの承認を待つ" || return
    # p0.4.3：held の記録に、判定の版と Codex を省いたか（--no-codex）と security の結論を残す。release はこれを確かめる（Codex の指摘 #3）
    jq -nc --arg ts "$(ts)" --arg t "$task" --arg r "$actual" --arg c "$candidate" --arg m "$main_sha" --arg j "$jv" --arg x "$cv" --arg sv "$sv" --argjson nc "$([ "$NO_CODEX" -eq 1 ] && echo true || echo false)" \
      --arg route "$route" --arg mj "$HELD_MAJORS" --argjson sr "$([ "$(front "$tmain" security_review)" = "true" ] && echo true || echo false)" \
      '{ts:$ts,task:$t,request:$r,candidate:$c,main_at_check:$m,judge:$j,codex:$x,security:$sv,no_codex:$nc,route:$route,majors:$mj,security_required:$sr,law:"p0.4.3"}' >> "$Z3/evidence/held.jsonl"
    log_event "held" "$task" "\"request\":\"${actual:0:12}\",\"candidate\":\"${candidate:0:12}\",\"judge\":\"$jv\",\"codex\":\"$cv\""
    mv "$req" "$DONE_DIR/"
    echo "  ⏸ $task は合格。朝のオーナーの承認を待つ（候補 ${candidate:0:12}）"
    return
  fi

  # 10 統合（main の checkout。未コミットの変更があれば止める）
  # p0.2.3：同じ実行の中で gate-runner 自身が書いた票（docs/tasks/）の変更は除いて確かめる（OBS-019）
  if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no -- . ':(exclude)docs/tasks')" ]; then
    fail "$task" "main の checkout に未コミットの変更がある。オーナーが片付けてから再申請" "review"; return
  fi
  # p0.3.1 案：統合するのは検査した候補のコミット（${candidate}）。候補は段階 2 の時点の main を親に持つので fast-forward になる。
  #   段階 2 以降に main が進んでいれば（同じ周回で別の票が統合された等）ここで止まり、次の周回で最新の main と組み合わせて検査し直す。
  if [ "$(git -C "$REPO" rev-parse main)" != "$main_sha" ]; then
    echo "  ↻ $task: 検査中に main が進んだ。次の周回で最新の main と組み合わせて検査し直す" >&2
    log_event "requeued" "$task" "\"reason\":\"main advanced during inspection\",\"main_at_check\":\"${main_sha:0:12}\""
    return
  fi
  if ! git -C "$REPO" merge --ff-only "$candidate" >/dev/null 2>&1; then
    fail "$task" "fast-forward できない（想定外。候補 ${candidate:0:12} が main を親に持たない）" && mv "$req" "$DONE_DIR/"; return
  fi
  local merged; merged="$(git -C "$REPO" rev-parse --short=12 HEAD)"
  # p0.4.2：統合は取り消さない。直前の確認の後に書きかけが生じて票に書けなければ、その事実を記録する（オーナーが票を merged に直す）
  set_ticket_status "$task" "merged" "main=$merged judge=$jv codex=$cv" || log_event "ticket_status_unwritten" "-" "\"for\":\"$task\",\"status\":\"merged\",\"main\":\"$merged\""
  log_event "merged" "$task" "\"main\":\"$merged\",\"judge\":\"$jv\",\"codex\":\"$cv\""
  update_board
  # p0.2.3：記録のコミットは1回の処理の最後にまとめる。ここでコミットすると main が進み、
  # 鎖で申請された次の票が「main を含まない」で止まるため（OBS-019）
  RUN_MERGED="${RUN_MERGED}${task}($jv/$cv) "
  mv "$req" "$DONE_DIR/"
  echo "  ✓ $task を統合: main=$merged"
}

# p0.4.3（OBS-053）：起動時の点検。司法と監査の道具がそろっていなければ起動しない（申請も票も触らない）。
#   2026-11-06 00:20、PATH に codex のない裁判所が T-015 を「セキュリティ審査が差し戻し」にした。道具の不在は判定ではない。
#   LLM の道具の有無は各司法の --preflight に委ねる（適合性テストの代わりの司法でも同じ形で通る。Max の点検 §9-2）
preflight() {
  local missing="" c
  for c in jq node git npm; do command -v "$c" >/dev/null 2>&1 || missing="$missing $c"; done
  for c in judge.sh sandboxed-run.sh; do [ -x "$BIN/$c" ] || missing="$missing bin/$c"; done
  [ -z "$missing" ] && ! "$BIN/sandboxed-run.sh" --preflight >/dev/null 2>&1 && missing="$missing sandbox"   # 監査の実依存（sandbox-exec・python3）
  [ -f "$BIN/spec-digest.mjs" ] || missing="$missing bin/spec-digest.mjs"
  [ "$NO_CODEX" -eq 1 ] || [ -x "$BIN/judge-codex.sh" ] || missing="$missing bin/judge-codex.sh"
  if [ -z "$missing" ]; then
    "$BIN/judge.sh" --preflight >/dev/null 2>&1 || missing="$missing judge"
    [ "$NO_CODEX" -eq 1 ] || "$BIN/judge-codex.sh" --preflight >/dev/null 2>&1 || missing="$missing codex"
  fi
  if [ -n "$missing" ]; then
    log_event "preflight_failed" "-" "\"missing\":\"$(printf '%s' "${missing# }" | tr -cd 'a-z0-9./ -')\""   # jq がなくても記録できるよう、文字を限って埋め込む
    echo "起動時の点検に失敗：${missing# } がない・動かない。裁判所は起動しない（申請と票は触らない）" >&2
    exit 69
  fi
}
# p0.4.3：Kernel の状態の書き出し（表示用の写し。docs/governance/kernel-state.json は git で追跡しない＝.gitignore）。
#   書くのは裁判所だけ。失敗しても周回は止めない（記録して続ける）。失敗の記録は、成功するまで1回だけ
KSTATE_OUT="$REPO/docs/governance/kernel-state.json"; KSTATE_FAILED=0
write_kernel_state() {
  if [ -f "$BIN/kernel-state.mjs" ] && node "$BIN/kernel-state.mjs" --repo "$REPO" --z3 "$Z3" --out "$KSTATE_OUT" >/dev/null 2>&1; then
    KSTATE_FAILED=0; return 0
  fi
  [ "$KSTATE_FAILED" -eq 1 ] || log_event "kernel_state_unwritten" "-" "\"script\":$([ -f "$BIN/kernel-state.mjs" ] && echo true || echo false)"
  KSTATE_FAILED=1; return 0
}
# p0.4.13（OBS-064 ③）：裁判所は1つだけ動かす。配置の後に古い裁判所が残り、2つが同じ申請を処理して held と記録を二重に書いた。
#   Z3 の .gate-runner.lock に自分の pid を書く。持ち主が生きていて gate-runner.sh として動いていれば起動しない（終了 75）。
#   持ち主がいなければ（落ちた）引き継ぐ。終わるとき、自分のロックだけを外す
# Codex の監査（major）：錠を書かない古い版の裁判所が残っていても見抜けるよう、同じスクリプトのファイル（絶対パス）を動かしている
#   ほかのプロセスがあれば起動しない（自分と、自分の子のサブシェルは除く）
SELF_PATH="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
for gp in $(pgrep -f -- "$SELF_PATH" 2>/dev/null || true); do
  [ "$gp" = "$$" ] && continue
  [ "$(ps -o ppid= -p "$gp" 2>/dev/null | tr -d ' ')" = "$$" ] && continue
  echo "同じ gate-runner（pid ${gp}）が動いている。二重に起動しない（配置の前に古い裁判所を止める）" >&2; exit 75
done
GLOCK="$Z3/.gate-runner.lock"
if ! mkdir "$GLOCK" 2>/dev/null; then
  gop="$(cat "$GLOCK/pid" 2>/dev/null || true)"
  if [[ "$gop" =~ ^[0-9]+$ ]] && kill -0 "$gop" 2>/dev/null && ps -p "$gop" -o command= 2>/dev/null | grep -q 'gate-runner\.sh'; then
    echo "別の gate-runner（pid ${gop}）が動いている。二重に起動しない" >&2; exit 75
  fi
  echo "前の gate-runner のロック（pid ${gop:-不明}）は持ち主がいない。引き継ぐ" >&2
  log_event "gate_lock_taken_over" "-" "\"prev_pid\":\"$(printf '%s' "${gop}" | tr -cd '0-9')\""
fi
echo "$$" > "$GLOCK/pid"
trap '[ "$(cat "$GLOCK/pid" 2>/dev/null)" = "$$" ] && rm -f "$GLOCK/pid" && rmdir "$GLOCK" 2>/dev/null; true' EXIT

preflight

echo "gate-runner 起動: repo=$REPO interval=${INTERVAL}s codex=$([ "$NO_CODEX" -eq 1 ] && echo off || echo on)"
STOPPED_LOGGED=0
while :; do
  check_git_config
  # p0.4.0：Kernel の停止中（Z3 の STOP。kernel-stop.sh）は申請を処理しない。判定も統合もせず、申請はそのまま残す
  if [ -f "$Z3/STOP" ]; then
    [ "$STOPPED_LOGGED" -eq 1 ] || { echo "⏹ Kernel の停止中：$(head -n 1 "$Z3/STOP")。申請は処理しない"; STOPPED_LOGGED=1; }
    write_kernel_state   # p0.4.3：停止中も「停止中」を書き出す（SPEC §8-2 の例外として列挙した唯一の書き込み）
    [ "$ONCE" -eq 1 ] && break
    sleep "$INTERVAL"; continue
  fi
  STOPPED_LOGGED=0
  shopt -s nullglob
  for req in "$REQ_DIR"/*.json; do
    [ ! -f "$Z3/STOP" ] || break   # p0.4.0：同じ周回の次の申請の前にも停止を見る（Codex の指摘 #6）
    process_request "$req" || echo "  ! $req の処理で例外" >&2
  done
  shopt -u nullglob
  # p0.2.3：この回の記録（統合・差し戻し）を1つのコミットにまとめる
  # p0.4.0：コミットするのは、この周回で gate-runner が書き換えた票と _board.json だけ（OBS-044）。
  #   以前は docs/tasks/ を丸ごと add しており、ほかの誰かのコミットしていない変更（README や別の票）まで gate-runner の名前で main に入った
  touched="$RUN_TOUCHED"; [ -z "$(git -C "$REPO" status --porcelain -- docs/tasks/_board.json)" ] || touched="$touched docs/tasks/_board.json"
  if [ -n "${touched// /}" ]; then
    # shellcheck disable=SC2086
    git -C "$REPO" add -- $touched && git -C "$REPO" -c user.name=gate-runner -c user.email=gate-runner@local commit -q \
      -m "gate-runner: 記録（統合: ${RUN_MERGED:-なし}）" -- $touched || true
  fi
  RUN_MERGED=""; RUN_TOUCHED=""
  # p0.3.0：証拠ストアのチェックポイント（件数と末尾の行のハッシュ）。末尾の切り詰めを verify-chain で検出する（D-56③）
  # p0.4.3（OBS-055）：件数と末尾の行は1回の読み取りで取る。p0.4.2 までは wc と tail を別々に読み、その間にフックが1行足すと
  #   「3552 行・末尾は 3553 行目」のチェックポイントになり、verify-chain が差し替えの疑いと誤って報告した（2026-11-06 01:18:23）
  local_cp() { awk 'END { print NR; printf "%s", $0 }' "$1"; }
  for lf in "$Z3/evidence/tool_calls.jsonl" "$EVENTS"; do
    [ -s "$lf" ] || continue
    snap="$(local_cp "$lf")"
    printf '{"ts":"%s","file":"%s","count":%s,"last_sha256":"%s"}\n' "$(ts)" "$(basename "$lf")" "${snap%%$'\n'*}" "$(printf '%s' "${snap#*$'\n'}" | shasum -a 256 | cut -c1-64)" >> "$Z3/evidence/checkpoints.jsonl"
  done
  # 事後検知：自分以外のコミットで main が進んでいないか（直接統合の違反の検知）
  LAST_MAIN_FILE="$Z3/evidence/.last_main"
  cur="$(git -C "$REPO" rev-parse HEAD)"
  if [ -f "$LAST_MAIN_FILE" ] && [ "$(cat "$LAST_MAIN_FILE")" != "$cur" ]; then
    author="$(git -C "$REPO" log -1 --format=%an "$cur")"
    [ "$author" = "gate-runner" ] || log_event "main_advanced_outside_gate" "-" "\"head\":\"${cur:0:12}\",\"author\":$(jq -Rn --arg a "$author" '$a')"
  fi
  echo "$cur" > "$LAST_MAIN_FILE"
  write_kernel_state   # p0.4.3：記録のコミットとチェックポイントの後に1回
  [ "$ONCE" -eq 1 ] && break
  sleep "$INTERVAL"
done
