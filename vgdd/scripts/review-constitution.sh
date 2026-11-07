#!/usr/bin/env bash
# VGDD Phase 1 — 憲法審査の起動（法律の改正のときだけ。オーナーが実行する）
#
# 法律（.claude/settings.json・vgdd/**・CLAUDE.md・docs/requirements.md §10）の改正案の差分を、
# constitutional-review サブエージェント（ツールなし、Sonnet）に、憲法の本文と改正の理由とともに渡す。
# 出力は vgdd.constitutional.v1 の JSON。判定は参考であり、承認はオーナーが行う。
#
# 使い方:
#   vgdd/scripts/review-constitution.sh --reason "理由（1〜3文）" [--base <ref>] [--files <paths...>] [--out DIR] [--dry-run]
#     --base   差分の基点（既定: HEAD。作業ツリーの未コミットの改正案を見る）
#     --files  差分の対象（既定: .claude/settings.json vgdd CLAUDE.md docs/requirements.md）
#
# 前提: .claude/agents/constitutional-review.md が配置済み（原本は vgdd/agents/）。claude CLI。

set -euo pipefail
REASON=""; BASE="HEAD"; OUT_DIR="${HOME}/tsubuyaki-z3/evidence/verdicts"; DRY=0; FILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --reason) REASON="$2"; shift 2;;
    --base) BASE="$2"; shift 2;;
    --out) OUT_DIR="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    --files) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do FILES+=("$1"); shift; done;;
    *) echo "不明な引数: $1" >&2; exit 64;;
  esac
done
[ -n "$REASON" ] || { echo "--reason に改正の理由を書いてください" >&2; exit 64; }
[ ${#FILES[@]} -gt 0 ] || FILES=(.claude/settings.json vgdd CLAUDE.md docs/requirements.md)

ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
DIFF="$(git diff "$BASE" -- "${FILES[@]}" || true)"
[ -n "$DIFF" ] || DIFF="（差分なし）"
CONST_CLAUDE="$(sed -n '/^## 守る約束/,/^## このファイル/p' CLAUDE.md)"
CONST_REQ="$(sed -n '/^## 10\. 作らないもの/,/^## 11\./p' docs/requirements.md)"
CONST_REQ2="$(sed -n '/^### 2\.2 /,/^### 2\.3 /p' docs/requirements.md)"
SPEC="VGDD 仕様 §3 の規則：1 評価対象のコードは Z2 でだけ実行し、評価用テストの入力だけを渡す／2 Z2 はネットワークを遮断／3 Z2 の出力はデータとしてだけ扱う／4 差し戻しで評価用テストの中身を返さない／5 秘密情報は Z1・Z2 に置かない／6 Z1 から他の領域への経路は Policy Engine を通るツール呼び出しだけ"

INPUT="$(cat <<EOF
# 憲法審査への入力

## 改正の理由
${REASON}

## 憲法：CLAUDE.md の約束
${CONST_CLAUDE}

## 憲法：要件定義 §2.2（守るべき見せ方）と §10（作らないもの）
${CONST_REQ2}
${CONST_REQ}

## 憲法：${SPEC}

## 改正案の差分（基点 ${BASE}）
\`\`\`diff
${DIFF}
\`\`\`

上の入力だけを使い、vgdd.constitutional.v1 の JSON で判定を返してください。
EOF
)"

if [ "$DRY" -eq 1 ]; then printf '%s\n' "$INPUT"; exit 0; fi
command -v claude >/dev/null || { echo "claude CLI が見つからない" >&2; exit 69; }
mkdir -p "$OUT_DIR"
# p0.4.9：呼び出しは予算の台帳の窓口（metered.sh）を通す（票のない「法律」の呼び出し）。拒まれたら出力なし＝VIOLATES（fail-closed）
METER="$(cd "$(dirname "$0")" && pwd)/metered.sh"
CLI_RC=0; RAW="$(printf '%s' "$INPUT" | "$METER" constitution - "${VGDD_CONSTITUTION_TOKENS:-300000}" claude -- claude -p --agent constitutional-review --output-format json --max-turns 1 2>/dev/null)" || CLI_RC=$?
OUT_FILE="$OUT_DIR/constitution-$(date +%Y%m%d-%H%M%S).json"
export RAW REASON CLI_RC
node - > "$OUT_FILE" <<'NODE'
const raw = process.env.RAW || ''; let text = raw;
// p0.4.9（Codex の監査 #8）：CLI が 0 で終わらなかった（予算の窓口の拒否を含む）ときは、本文によらず審査できなかったものとして扱う
const unavailable = process.env.CLI_RC !== '0';
try { const o = JSON.parse(raw); if (o && typeof o.result === 'string') text = o.result; } catch {}
let v = null; if (!unavailable) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { v = JSON.parse(m[0]); } catch {} } }
process.stdout.write(JSON.stringify({ type: 'constitutional_review', reason: process.env.REASON, review: v, parse_ok: !!v, unavailable, verdict: v?.verdict ?? 'VIOLATES', note: unavailable ? '審査を実行できなかった（予算の窓口の拒否か CLI の失敗。fail-closed で VIOLATES と記録する）' : v ? null : '出力を JSON として解釈できない（fail-closed）' }, null, 2) + '\n');
NODE
echo "憲法審査: $(node -e "console.log(require('$OUT_FILE').verdict)")  （保存: ${OUT_FILE}）"
