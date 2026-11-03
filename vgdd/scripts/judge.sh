#!/usr/bin/env bash
# VGDD Phase 1 — 司法（judge サブエージェント）の起動スクリプト
#
# 使うのはオーナーか夜間スクリプト。開発エージェント（行政）は呼ばない。
# 差分・要件 ID・決定論的監査の結果を**機械的に**集めて judge に渡す。
# 行政の説明文・コミットメッセージ・会話は渡さない（情報の独立。仕様 §4 補足）。
#
# 使い方:
#   vgdd/scripts/judge.sh --req M1-1,M1-2,M1-3 [--base origin/main] [--task T-001] [--out DIR] [--dry-run]
#   vgdd/scripts/judge.sh --ticket docs/tasks/T-000-xxx.md [--base main] ...   # 基盤の票（requirements_source: ticket）
#     --req      判定対象の受け入れ基準 ID（カンマ区切り）。docs/requirements.md から本文を抜き出す
#     --ticket   タスク票（docs/tasks/T-NNN-*.md。パスは絶対でも相対でもよく、basename だけを使う）。
#                票は **main にコミット済みのもの**（`git show main:docs/tasks/…`）を読む（OBS-015②。作業ブランチや作業ツリーの票は使わない）。
#                その front matter が `requirements_source: ticket` なら、docs/requirements.md ではなく票の
#                「## N. 受け入れ条件（または完了条件）」の節を要件として渡し、ID は節の「- A1.」… から取る（p0.2.1）。
#                main にない → exit 66。作業ブランチの HEAD や作業ツリーの票で条件の節が main と違う → exit 65（fail-closed）。
#                `requirements_source` がなければ従来どおり（--req が必要）
#     --base     差分の基点（既定: origin/main と HEAD の merge-base。なければ HEAD~1）
#     --task     タスク ID（記録用。既定: 日時）
#     --out      判定 JSON の保存先（既定: ~/tsubuyaki-z3/evidence/verdicts/。z3 に書けるのはオーナー側だけ）
#     --dry-run  judge を呼ばず、組み立てた入力を表示して終わる
#
# 前提: .claude/agents/judge.md が配置済み（原本は vgdd/agents/judge.md）。claude CLI が使える。
# 規則: 決定論的監査（型検査・テスト・lint）の不合格は LLM の判定で取り消せない。
#       judge が APPROVED を返しても監査が不合格なら、このスクリプトが CHANGES_REQUIRED に上書きして記録する。

set -euo pipefail

REQ=""; BASE=""; TASK=""; OUT_DIR="${HOME}/tsubuyaki-z3/evidence/verdicts"; DRY=0; EMIT=0; STATE_FILE=""; TICKET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --req) REQ="$2"; shift 2;;
    --ticket) TICKET="$2"; shift 2;;
    --base) BASE="$2"; shift 2;;
    --task) TASK="$2"; shift 2;;
    --out) OUT_DIR="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    # --emit-input：judge を呼ばず、組み立てた入力だけを標準出力に出す（judge-codex.sh・gate-runner が同じ入力を使うため）
    --emit-input) EMIT=1; shift;;
    # --audit-state-file：--emit-input のとき、TASK/BRANCH/HEAD_SHA/BASE/STAMP/REQ/AUDIT_STATE を shell 変数の形で書き出す先
    --audit-state-file) STATE_FILE="$2"; shift 2;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) echo "不明な引数: $1" >&2; exit 64;;
  esac
done
[ -n "$REQ" ] || [ -n "$TICKET" ] || { echo "--req に受け入れ基準 ID（例: --req M1-1,M1-2）か、--ticket に票のパスを指定してください" >&2; exit 64; }
# 票は docs/tasks/ にある。どのパスで渡されても main のコミットから読むので、basename だけを使う（OBS-015②）
TICKET_REL=""; [ -z "$TICKET" ] || TICKET_REL="docs/tasks/$(basename "$TICKET")"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
TASK="${TASK:-T-$(date +%Y%m%d-%H%M%S)}"
STAMP="$(date +%Y-%m-%dT%H:%M:%S%z)"

# ---- 差分の基点 -----------------------------------------------------------
if [ -z "$BASE" ]; then
  if git rev-parse --verify -q origin/main >/dev/null; then
    BASE="$(git merge-base origin/main HEAD)"
  else
    BASE="$(git rev-parse HEAD~1 2>/dev/null || git hash-object -t tree /dev/null)"
  fi
fi
BRANCH="$(git branch --show-current || echo '(detached)')"
HEAD_SHA="$(git rev-parse --short=12 HEAD)"

# 作業ツリーの未コミット分も含めて見る（夜間はコミット単位、手動は作業中も判定できるように）
DIFF_STAT="$(git diff --stat "$BASE" -- . ':(exclude)package-lock.json' || true)"
DIFF_BODY="$(git diff "$BASE" -- . ':(exclude)package-lock.json' || true)"
DIFF_LINES="$(printf '%s\n' "$DIFF_BODY" | wc -l | tr -d ' ')"
MAX_DIFF_LINES=4000
DIFF_NOTE=""
if [ "$DIFF_LINES" -gt "$MAX_DIFF_LINES" ]; then
  DIFF_BODY="$(printf '%s\n' "$DIFF_BODY" | head -n "$MAX_DIFF_LINES")"
  DIFF_NOTE="（差分が ${DIFF_LINES} 行あり、先頭 ${MAX_DIFF_LINES} 行だけを渡した。残りは未確認として扱うこと）"
fi

# ---- 要件の本文 -----------------------------------------------------------------
# p0.2.1：票の front matter が `requirements_source: ticket` なら（基盤の票。利用者に見える機能を足さない票）、
#   docs/requirements.md ではなく、票の「## N. 受け入れ条件（完了条件）」の節をそのまま要件として渡す。
#   ID は節の「- A1.」「- A2.」… から取る（--req があればそれを優先）。それ以外は従来どおり docs/requirements.md の表の行。
# OBS-015②：票は main にコミット済みのもの（git show main:…）だけを使う。行政・作業員が作業ブランチや作業ツリーで
#   条件を書き換えても効かない。main にない → exit 66。ブランチの HEAD や作業ツリーの票の節が main と違う → exit 65。
REQ_SOURCE="docs/requirements.md"
REQ_TEXT=""
section_of() { awk '/^## [0-9]+\. (受け入れ条件|完了条件)/ { on=1; print; next } /^## / { on=0 } on'; }
front_of() { sed -n '/^---$/,/^---$/p' | sed -n "s/^$1: *//p" | head -n 1 | sed 's/ *#.*$//' | tr -d ' '; }
if [ -n "${TICKET_REL}" ]; then
  TICKET_MAIN="$(git show "main:${TICKET_REL}" 2>/dev/null || true)"
  [ -n "$TICKET_MAIN" ] || { echo "票が main にコミットされていない: ${TICKET_REL}（票は作業を始める前に main にコミットする。fail-closed）" >&2; exit 66; }
  src="$(printf '%s\n' "$TICKET_MAIN" | front_of requirements_source)"
  if [ "$src" = "ticket" ]; then
    SECTION="$(printf '%s\n' "$TICKET_MAIN" | section_of)"
    [ -n "$SECTION" ] || { echo "main の票に「## N. 受け入れ条件」の節がない: ${TICKET_REL}" >&2; exit 65; }
    # 作業ブランチの HEAD と作業ツリーの票が main と違えば fail-closed（条件のすり替えを止める）
    for other in HEAD worktree; do
      if [ "$other" = worktree ]; then
        [ -f "${TICKET_REL}" ] || continue
        txt="$(cat "${TICKET_REL}")"
      else
        txt="$(git show "HEAD:${TICKET_REL}" 2>/dev/null || true)"
        [ -n "$txt" ] || continue
      fi
      [ "$(printf '%s\n' "$txt" | section_of)" = "$SECTION" ] || {
        echo "票の受け入れ条件が main と違う（$other の ${TICKET_REL}）。基盤の票の条件は main のものだけを使う（fail-closed）" >&2; exit 65; }
    done
    REQ_SOURCE="ticket:main:${TICKET_REL}"
    [ -n "$REQ" ] || REQ="$(printf '%s\n' "$SECTION" | sed -n -E 's/^- (A[0-9]+)\..*/\1/p' | paste -sd, -)"
    [ -n "$REQ" ] || { echo "票の受け入れ条件に「- A1.」形式の項目がない: ${TICKET_REL}" >&2; exit 65; }
    REQ_TEXT="（要件の出典：main にコミット済みの票 ${TICKET_REL} の受け入れ条件。この票は基盤の票で、docs/requirements.md の ID では判定しない）"$'\n\n'"${SECTION}"$'\n'
  fi
fi
if [ -z "$REQ_TEXT" ]; then
  [ -n "$REQ" ] || { echo "票に requirements_source: ticket がないため --req が必要: ${TICKET_REL}" >&2; exit 64; }
  IFS=',' read -r -a IDS <<< "$REQ"
  for id in "${IDS[@]}"; do
    id="$(echo "$id" | tr -d ' ')"
    line="$(grep -E "^\| ${id}( |\*)" docs/requirements.md | head -n 1 || true)"
    if [ -n "$line" ]; then
      REQ_TEXT+="${line}"$'\n'
    else
      REQ_TEXT+="| ${id} | （docs/requirements.md に見つからない） | |"$'\n'
    fi
  done
fi

# ---- 決定論的監査（package.json にあるものだけ実行。出力は末尾 40 行） -----------
AUDIT_TEXT=""; AUDIT_FAIL=0; AUDIT_RAN=0
run_audit() { # name, command...
  local name="$1"; shift
  local out rc
  set +e
  out="$("$@" 2>&1)"; rc=$?
  set -e
  AUDIT_RAN=1
  [ "$rc" -eq 0 ] || AUDIT_FAIL=1
  AUDIT_TEXT+="### ${name}  exit=${rc}"$'\n'"$(printf '%s\n' "$out" | tail -n 40)"$'\n\n'
}
has_script() { [ -f package.json ] && node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }
if [ -f package.json ]; then
  if has_script typecheck; then run_audit "型検査 (npm run typecheck)" npm run -s typecheck; fi
  if has_script test;      then run_audit "テスト (npm test)"          npm test -s;           fi
  if has_script lint;      then run_audit "lint (npm run lint)"       npm run -s lint;       fi
else
  AUDIT_TEXT="（package.json がないため、決定論的監査は未実行。judge は unverified として扱う）"$'\n'
fi
[ -n "$AUDIT_TEXT" ] || AUDIT_TEXT="（package.json に typecheck / test / lint のスクリプトがない。未実行）"$'\n'

# ---- judge への入力（行政の説明文は含めない） ----------------------------------
INPUT="$(cat <<EOF
# VGDD 司法への入力（機械的に収集。人や行政エージェントの説明文は含まない）

task_id: ${TASK}
branch: ${BRANCH}
head: ${HEAD_SHA}
base: ${BASE}
collected_at: ${STAMP}
requirements_source: ${REQ_SOURCE}

## 要件（判定対象の受け入れ基準。ID: ${REQ}）
${REQ_TEXT}
## 決定論的監査の結果
deterministic_audits_passed: $(if [ "$AUDIT_RAN" -eq 0 ]; then echo "not_run（未実行＝合格ではない）"; elif [ "$AUDIT_FAIL" -eq 0 ]; then echo true; else echo false; fi)

${AUDIT_TEXT}
## 差分の統計
${DIFF_STAT:-（差分なし）}

## 差分の本文 ${DIFF_NOTE}
\`\`\`diff
${DIFF_BODY:-（差分なし）}
\`\`\`

上の入力だけを使い、指定の JSON スキーマ（vgdd.verdict.v1）で判定を返してください。
EOF
)"

AUDIT_STATE="$(if [ "$AUDIT_RAN" -eq 0 ]; then echo not_run; elif [ "$AUDIT_FAIL" -eq 0 ]; then echo passed; else echo failed; fi)"

if [ "$EMIT" -eq 1 ]; then
  if [ -n "$STATE_FILE" ]; then
    {
      printf 'TASK=%q\nBRANCH=%q\nHEAD_SHA=%q\nBASE=%q\nSTAMP=%q\nREQ=%q\nAUDIT_STATE=%q\nREQ_SOURCE=%q\n' \
        "$TASK" "$BRANCH" "$HEAD_SHA" "$BASE" "$STAMP" "$REQ" "$AUDIT_STATE" "$REQ_SOURCE"
    } > "$STATE_FILE"
  fi
  printf '%s' "$INPUT"
  exit 0
fi

if [ "$DRY" -eq 1 ]; then
  printf '%s\n' "$INPUT"
  echo "--- dry-run: judge は呼んでいない。監査 実行=${AUDIT_RAN} 不合格=${AUDIT_FAIL} ---" >&2
  exit 0
fi

# ---- judge を起動（ヘッドレス。ツールなしの判定だけ） -----------------------------
command -v claude >/dev/null || { echo "claude CLI が見つからない" >&2; exit 69; }
RAW="$(printf '%s' "$INPUT" | claude -p --agent judge --output-format json --max-turns 1 2>/dev/null || true)"

# ---- 出力の取り出しと、決定論的監査による上書き -------------------------------
mkdir -p "$OUT_DIR"
OUT_FILE="${OUT_DIR}/${TASK}-${HEAD_SHA}.json"
export RAW AUDIT_FAIL AUDIT_RAN TASK BRANCH HEAD_SHA BASE STAMP REQ REQ_SOURCE
node - > "$OUT_FILE" <<'NODE'
const raw = process.env.RAW || '';
let text = raw;
try { const o = JSON.parse(raw); if (o && typeof o.result === 'string') text = o.result; } catch {}
let verdict = null;
const m = text.match(/\{[\s\S]*\}/);
if (m) { try { verdict = JSON.parse(m[0]); } catch {} }
const auditFail = process.env.AUDIT_FAIL === '1';
const auditRan = process.env.AUDIT_RAN === '1';
// 未実行は合格ではない（judge の指摘 2026-11-03：未実行と合格を区別する）
const auditState = !auditRan ? 'not_run' : (auditFail ? 'failed' : 'passed');
const record = {
  type: 'verdict',
  task_id: process.env.TASK,
  branch: process.env.BRANCH,
  head: process.env.HEAD_SHA,
  base: process.env.BASE,
  requirements_requested: process.env.REQ.split(',').map(s => s.trim()),
  requirements_source: process.env.REQ_SOURCE || 'docs/requirements.md',
  collected_at: process.env.STAMP,
  judge: verdict,
  judge_parse_ok: !!verdict,
  deterministic_audits: auditState,
  deterministic_audits_passed: auditState === 'passed',
  final_verdict: null,
  overridden_by_deterministic_audit: false,
  note: null,
};
if (!verdict) {
  record.final_verdict = 'CHANGES_REQUIRED';
  record.note = 'judge の出力を JSON として解釈できない（fail-closed）';
} else if (auditState !== 'passed' && verdict.verdict === 'APPROVED') {
  record.final_verdict = 'CHANGES_REQUIRED';
  record.overridden_by_deterministic_audit = true;
  record.note = auditState === 'failed'
    ? '決定論的監査が不合格のため、LLM の APPROVED を取り消した（仕様 §4：LLM は不合格を足すだけ）'
    : '決定論的監査が未実行（package.json や scripts がない）のため、LLM の APPROVED を取り消した（未実行は合格ではない）';
} else if (verdict.verdict === 'APPROVED' || verdict.verdict === 'CHANGES_REQUIRED') {
  record.final_verdict = verdict.verdict;
} else {
  record.final_verdict = 'CHANGES_REQUIRED';
  record.note = `verdict の値が不正: ${String(verdict.verdict)}`;
}
process.stdout.write(JSON.stringify(record, null, 2) + '\n');
NODE

FINAL="$(node -e "console.log(require('$OUT_FILE').final_verdict)")"
echo "判定: ${FINAL}  （保存: ${OUT_FILE}）"
[ "$FINAL" = "APPROVED" ] && exit 0 || exit 1
