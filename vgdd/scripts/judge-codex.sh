#!/usr/bin/env bash
# VGDD Phase 1 — 別系統の司法（Codex judge）／セキュリティ審査／UX 審査
#
# judge.sh と**同じ入力**（差分・要件 ID・決定論的な監査の結果。行政の説明文は含めない）を Codex CLI に渡し、
# judge と同じスキーマ（vgdd.verdict.v1）の判定を得る。使うのはオーナーか gate-runner（sandbox の外）。
#
# 使い方:
#   vgdd/scripts/judge-codex.sh --req M1-1,M1-2 [--base <ref>] [--task T-001] [--out DIR] [--dry-run]
#   vgdd/scripts/judge-codex.sh --ticket docs/tasks/T-000-xxx.md ...   # 基盤の票（requirements_source: ticket）。judge.sh にそのまま渡る
#   vgdd/scripts/judge-codex.sh --security --req M6-1 ...   # セキュリティ審査（観点を足す）
#
# p0.2.1: スキーマ vgdd.verdict.v1 は OpenAI の構造化出力（strict）の制約に合わせた：全プロパティを required に入れ、
#         任意の項目は null を許す型にする。const は enum にした。初回（2026-11-03 17:26）は findings.items.required に
#         requirement_id がなく codex exec がスキーマを拒否して判定なし→fail-closed になった
#   vgdd/scripts/judge-codex.sh --ux --shots DIR ...        # UX 審査（スクリーンショットの説明文を渡す。画像の添付は Codex の対応次第）
#
# 前提: codex CLI がログイン済み（オーナーの契約。学習に使われない設定を 2026-11-03 に確認済み）。
#       非対話実行は `codex exec`：プロンプトは標準入力（`-`）、既定で読み取り専用の sandbox、`--output-schema` で JSON に固定、
#       `-o` で最終メッセージをファイルに、`--ephemeral` で記録を残さない、`--skip-git-repo-check`。
#       モデルの指定は公式ページに記載がなかったため、CODEX_EXTRA_ARGS（例: "--model gpt-5-codex"）でオーナーが与える。p0.4.10a からはモデルの指定だけを許す。
# 規則: 決定論的監査の不合格は LLM の判定で取り消せない（judge.sh と同じ上書き）。送る差分は合成データだけ。

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MODE="judge"; SHOTS=""; PASSTHRU=()
while [ $# -gt 0 ]; do
  case "$1" in
    --security) MODE="security"; shift;;
    --ux) MODE="ux"; shift;;
    --shots) SHOTS="$2"; shift 2;;
    --out) OUT_DIR="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    # p0.4.3（OBS-053）：gate-runner の起動時の点検。codex が動けば 0、なければ 69（判定はしない）
    --preflight) if command -v codex >/dev/null 2>&1 && codex --version >/dev/null 2>&1; then exit 0; else exit 69; fi;;   # set -e の下でも 69 で終わる（Codex の指摘 #4）
    *) PASSTHRU+=("$1"); shift;;
  esac
done
OUT_DIR="${OUT_DIR:-${HOME}/tsubuyaki-z3/evidence/verdicts}"
DRY="${DRY:-0}"

# ---- 入力を judge.sh と同じ関数で組み立てる（--emit-input） ------------------------
TMP_BASE="${TMPDIR:-/tmp}"
STATE_FILE="$(mktemp "$TMP_BASE/judge-codex-state.XXXXXX")"
INPUT="$("$HERE/judge.sh" "${PASSTHRU[@]}" --emit-input --audit-state-file "$STATE_FILE")"
# shellcheck disable=SC1090
source "$STATE_FILE"   # TASK, BRANCH, HEAD_SHA, BASE, STAMP, REQ, AUDIT_STATE を読む
rm -f "$STATE_FILE"

case "$MODE" in
  security)
    INPUT="${INPUT}

# セキュリティ審査の観点（追加）
次の観点でも findings を出すこと（category は security）：入力の検証（zod 等）、認可（他人のセッション・メモに触れないか）、
秘密情報の扱い（API キー・個人情報がログや応答に出ないか）、依存パッケージの追加・更新（必要性、既知の脆弱性）、
子プロセス・eval・動的 import の新規使用、ファイルパスの組み立て（ディレクトリトラバーサル）。"
    ;;
  ux)
    SHOT_TEXT="（スクリーンショットの説明なし）"
    if [ -n "$SHOTS" ] && [ -d "$SHOTS" ]; then
      SHOT_TEXT="$(ls -1 "$SHOTS" | sed 's/^/- /')"
    fi
    INPUT="${INPUT}

# UX 審査の観点（追加）
利用者（新人A・新人B・先輩C）の立場で、画面の操作の流れ・文言・待ち時間・誤操作のしやすさについて findings を出すこと（category は correctness）。
参照できるスクリーンショット：
${SHOT_TEXT}"
    ;;
esac

if [ "$DRY" = "1" ]; then
  printf '%s\n' "$INPUT"
  echo "--- dry-run: codex は呼んでいない。MODE=$MODE AUDIT_STATE=$AUDIT_STATE ---" >&2
  exit 0
fi

# p0.4.10a（Codex の2回目の監査 major）：窓口は kind=codex の呼び出しに限り、子が終わった後に残った子孫を片付けて成功として精算する。
#   その前提の「読み取り専用」を実装で固定する：-s read-only を必ず渡し、追加の引数（CODEX_EXTRA_ARGS）はモデルの指定（--model 名前・-m 名前）だけを許す。
#   ほかの引数（sandbox の変更・設定の上書き・承認の省略など）があれば Codex を呼ばずに終了 64（判定のファイルを書かない＝裁判所は「司法が使えない」として扱う）
CODEX_ARGS=()
if [ -n "${CODEX_EXTRA_ARGS:-}" ]; then
  case "${CODEX_EXTRA_ARGS}" in *$'\n'*|*$'\r'*) echo "CODEX_EXTRA_ARGS に改行がある" >&2; exit 64 ;; esac   # read は1行目しか読まない（Codex の3回目の監査 minor）
  read -r -a _xa <<< "${CODEX_EXTRA_ARGS}"
  _i=0
  while [ "${_i}" -lt "${#_xa[@]}" ]; do
    case "${_xa[${_i}]}" in
      --model|-m)
        _n="${_xa[$((_i + 1))]:-}"
        [[ "${_n}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "CODEX_EXTRA_ARGS のモデルの名前が不正" >&2; exit 64; }
        CODEX_ARGS+=("${_xa[${_i}]}" "${_n}"); _i=$((_i + 2)) ;;
      *) echo "CODEX_EXTRA_ARGS に許されない引数（モデルの指定だけを許す）" >&2; exit 64 ;;
    esac
  done
fi
command -v codex >/dev/null || { echo "codex CLI が見つからない（オーナーの環境で実行する）" >&2; exit 69; }
mkdir -p "$OUT_DIR"
LAST="$(mktemp "$TMP_BASE/judge-codex-last.XXXXXX")"
# shellcheck disable=SC2086
# p0.4.9：呼び出しは予算の台帳の窓口（metered.sh）を通す。Codex の利用量はまだ読まないので、予約の全量で数える（0 にしない）。拒まれたら CLI の失敗として扱う
METER="$(cd "$HERE" && pwd)/metered.sh"
printf '%s' "$INPUT" | "$METER" codex "$TASK" "${VGDD_CODEX_TOKENS:-300000}" none -- codex exec - \
  --output-schema "$HERE/../schemas/verdict.schema.json" \
  -s read-only -o "$LAST" --ephemeral --skip-git-repo-check ${CODEX_ARGS[@]+"${CODEX_ARGS[@]}"} >/dev/null 2>"$OUT_DIR/.codex-stderr.log" && CLI_RC=0 || CLI_RC=$?   # p0.4.3：終了状態を残す
RAW="$(cat "$LAST" 2>/dev/null || true)"
rm -f "$LAST"

OUT_FILE="${OUT_DIR}/${TASK}-${HEAD_SHA}-codex-${MODE}.json"
export RAW AUDIT_STATE TASK BRANCH HEAD_SHA BASE STAMP REQ MODE REQ_SOURCE CLI_RC
node - > "$OUT_FILE" <<'NODE'
const raw = process.env.RAW || '';
// p0.4.3（Codex の3回目の監査 #1 critical）：判定のスキーマ（vgdd.verdict.v1）の完全な検証。余分なキー・欠けたキー・型・列挙値のどれかが違えば false
const VERDICT_KEYS = ['schema', 'verdict', 'deterministic_audits_passed', 'requirements', 'findings', 'summary'];
const REQ_KEYS = ['id', 'status', 'evidence'];
const FIND_KEYS = ['severity', 'category', 'file', 'line', 'requirement_id', 'reason'];
const exactKeys = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const strOrNull = (v) => v === null || typeof v === 'string';
const wellFormed = (v) => exactKeys(v, VERDICT_KEYS) && v.schema === 'vgdd.verdict.v1' && (v.verdict === 'APPROVED' || v.verdict === 'CHANGES_REQUIRED')
  && typeof v.deterministic_audits_passed === 'boolean' && typeof v.summary === 'string'
  && Array.isArray(v.requirements) && v.requirements.every((r) => exactKeys(r, REQ_KEYS) && typeof r.id === 'string' && ['met', 'not_met', 'unverified'].includes(r.status) && typeof r.evidence === 'string')
  && Array.isArray(v.findings) && v.findings.every((f) => exactKeys(f, FIND_KEYS) && ['critical', 'major', 'minor'].includes(f.severity)
    && ['requirement', 'correctness', 'security', 'test', 'protected_path', 'input'].includes(f.category) && strOrNull(f.file)
    && (f.line === null || Number.isInteger(f.line)) && strOrNull(f.requirement_id) && typeof f.reason === 'string');
// 本文全体を1つの JSON オブジェクトとして読む（前後の空白と、全体を囲む ```json の囲みだけを許す。正規表現で途中を取り出さない）
const parseWhole = (text) => {
  let t = String(text || '').trim();
  const fence = t.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1].trim();
  try { const o = JSON.parse(t); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
};
// judge.sh と同じ「判定として成り立つ」条件（本文全体が1つの JSON オブジェクトで、スキーマに完全に合う）
const verdict = parseWhole(raw);
const malformed = process.env.CLI_RC !== '0' || !wellFormed(verdict);
const auditState = process.env.AUDIT_STATE || 'not_run';
const record = {
  type: 'verdict',
  judge: 'codex',
  mode: process.env.MODE,
  task_id: process.env.TASK,
  branch: process.env.BRANCH,
  head: process.env.HEAD_SHA,
  base: process.env.BASE,
  requirements_requested: (process.env.REQ || '').split(',').map(s => s.trim()).filter(Boolean),
  requirements_source: process.env.REQ_SOURCE || 'docs/requirements.md',
  collected_at: process.env.STAMP,
  codex: verdict,
  parse_ok: !!verdict && !malformed,   // p0.4.3：false は「司法が使えない」
  deterministic_audits: auditState,
  final_verdict: null,
  overridden_by_deterministic_audit: false,
  note: null,
};
if (!verdict || malformed) { record.final_verdict = 'CHANGES_REQUIRED'; record.note = verdict ? 'Codex の出力が判定の形をしていない・CLI が失敗した（fail-closed。判定ではない）' : 'Codex の出力を JSON として解釈できない（fail-closed）'; }
else if (auditState !== 'passed' && verdict.verdict === 'APPROVED') {
  record.final_verdict = 'CHANGES_REQUIRED'; record.overridden_by_deterministic_audit = true;
  record.note = auditState === 'failed' ? '決定論的監査が不合格のため、Codex の APPROVED を取り消した' : '決定論的監査が未実行のため、Codex の APPROVED を取り消した';
} else if (verdict.verdict === 'APPROVED' || verdict.verdict === 'CHANGES_REQUIRED') { record.final_verdict = verdict.verdict; }
else { record.final_verdict = 'CHANGES_REQUIRED'; record.note = `verdict の値が不正: ${String(verdict.verdict)}`; }
process.stdout.write(JSON.stringify(record, null, 2) + '\n');
NODE
FINAL="$(node -e "console.log(require('$OUT_FILE').final_verdict)")"
echo "Codex 判定（${MODE}）: ${FINAL}  （保存: ${OUT_FILE}）"
[ "$FINAL" = "APPROVED" ] && exit 0 || exit 1
